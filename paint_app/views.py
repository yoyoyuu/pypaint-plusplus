# paint_app/views.py

# --- Librerias ---
from django.shortcuts import render
from django.http import JsonResponse
from django.conf import settings
import os
import json
import base64
from PIL import Image
import io
import traceback
import uuid
import ctypes

from .models import CanvasState
from django.db.models import Max

# --- Constantes y Configuracion ---
MAX_HISTORY_SIZE = 20

# --- Cargar la Librería C++ (DLL) y Definir Funciones ---
paint_lib = None
try:
    paint_lib = ctypes.CDLL(settings.PAINT_LIBRARY_PATH)
    print(f"[VIEWS_PY] Librería C++ cargada exitosamente desde: {settings.PAINT_LIBRARY_PATH}")

    paint_lib.dibujar_trazo_pincel.argtypes = [ctypes.POINTER(ctypes.c_ubyte), ctypes.c_int, ctypes.c_int, ctypes.c_char_p, ctypes.c_char_p, ctypes.c_int]
    paint_lib.dibujar_trazo_pincel.restype = ctypes.c_int

    paint_lib.dibujar_trazo_borrador.argtypes = [ctypes.POINTER(ctypes.c_ubyte), ctypes.c_int, ctypes.c_int, ctypes.c_char_p, ctypes.c_int]
    paint_lib.dibujar_trazo_borrador.restype = ctypes.c_int

    paint_lib.rellenar_area.argtypes = [ctypes.POINTER(ctypes.c_ubyte), ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_char_p]
    paint_lib.rellenar_area.restype = ctypes.c_int

    paint_lib.dibujar_linea.argtypes = [ctypes.POINTER(ctypes.c_ubyte), ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_char_p, ctypes.c_int]
    paint_lib.dibujar_linea.restype = ctypes.c_int

    paint_lib.dibujar_rectangulo.argtypes = [ctypes.POINTER(ctypes.c_ubyte), ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_bool, ctypes.c_char_p]
    paint_lib.dibujar_rectangulo.restype = ctypes.c_int

except (OSError, AttributeError) as e:
    print(f"[VIEWS_PY] ERROR CRÍTICO: No se pudo cargar o configurar la librería C++: {e}")
    paint_lib = None

# --- Funciones Auxiliares ---
def convertir_ppm_bytes_a_png_base64(ppm_bytes):
    if not ppm_bytes: return None
    try:
        img = Image.open(io.BytesIO(ppm_bytes))
        img.load()
        buffer_memoria_png = io.BytesIO()
        img.save(buffer_memoria_png, format="PNG")
        img_str_base64 = base64.b64encode(buffer_memoria_png.getvalue()).decode('utf-8')
        return f"data:image/png;base64,{img_str_base64}"
    except Exception as e:
        print(f"[VIEWS_PY] Error convirtiendo bytes PPM a PNG Base64: {e}")
        traceback.print_exc()
        return None

def get_or_create_drawing_session(request, width=800, height=600, color_hex="FFFFFF"):
    drawing_id = request.session.get('current_drawing_id')
    current_version_pointer = request.session.get('current_version_pointer', -1)
    initial_ppm_bytes = None

    if not drawing_id or current_version_pointer == -1 or not CanvasState.objects.filter(drawing_id=drawing_id, version=current_version_pointer).exists():
        print(f"[VIEWS_PY] Sesión de dibujo no encontrada o puntero inválido. Creando nueva.")
        drawing_id = str(uuid.uuid4())
        request.session['current_drawing_id'] = drawing_id
        
        try:
            img = Image.new('RGBA', (width, height), color=f'#{color_hex}')
            img_rgb = img.convert('RGB')
            buffer_ppm = io.BytesIO()
            img_rgb.save(buffer_ppm, format='PPM')
            initial_ppm_bytes = buffer_ppm.getvalue()
            
            CanvasState.objects.filter(drawing_id=drawing_id).delete()
            CanvasState.objects.create(
                drawing_id=drawing_id,
                version=0,
                image_data_ppm=initial_ppm_bytes
            )
            current_version_pointer = 0
            request.session['current_version_pointer'] = current_version_pointer
            request.session.modified = True
            print(f"[VIEWS_PY] Nuevo dibujo {drawing_id} v0 creado con Pillow y guardado en BD.")
        except Exception as e:
            print(f"[VIEWS_PY] Error creando lienzo inicial: {e}")
            traceback.print_exc()
            return None, -1, None
    else:
        try:
            current_state = CanvasState.objects.get(drawing_id=drawing_id, version=current_version_pointer)
            initial_ppm_bytes = current_state.image_data_ppm
            print(f"[VIEWS_PY] Estado recuperado de BD: {drawing_id} v{current_version_pointer}")
        except CanvasState.DoesNotExist:
            print(f"[VIEWS_PY] ERROR CRÍTICO: Estado no encontrado en BD. Reiniciando sesión.")
            if 'current_drawing_id' in request.session: del request.session['current_drawing_id']
            if 'current_version_pointer' in request.session: del request.session['current_version_pointer']
            request.session.modified = True
            return get_or_create_drawing_session(request, width, height, color_hex)

    return drawing_id, current_version_pointer, initial_ppm_bytes

# --- Vistas ---
def vista_pagina_paint(request):
    return render(request, 'paint_app/paint.html')

def vista_api_dibujo(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Solo se permiten peticiones POST'}, status=405)

    if not paint_lib:
        return JsonResponse({'error': 'Error del servidor: Componente de dibujo no está disponible.'}, status=500)

    try:
        datos_recibidos = json.loads(request.body.decode('utf-8'))
        herramienta_actual = datos_recibidos.get('tool')
        print(f"[VIEWS_PY] API Recibida: tool='{herramienta_actual}'")

        drawing_id, current_version_ptr, current_ppm_data = get_or_create_drawing_session(
            request,
            width=datos_recibidos.get('width', 800),
            height=datos_recibidos.get('height', 600),
            color_hex=datos_recibidos.get('color', "FFFFFF")
        )

        if not drawing_id or current_ppm_data is None:
            return JsonResponse({'error': 'No se pudo inicializar/recuperar la sesión de dibujo.'}, status=500)

        datos_respuesta = {}
        new_ppm_data_to_return = None
        
        is_drawing_operation = herramienta_actual in ["pincel_trazo", "borrador_trazo", "bote", "linea", "rectangulo"]

        # --- BLOQUE DE LA LOGICA PRINCIPAL ---

        if is_drawing_operation:
            try:
                # Convertir PPM de la BD a un buffer de pixeles crudo RGBA para C++
                img = Image.open(io.BytesIO(current_ppm_data))
                img.load()
                if img.mode != 'RGBA':
                    img = img.convert('RGBA')
                
                width, height = img.size
                pixel_data = img.tobytes()
                buffer = ctypes.create_string_buffer(pixel_data, len(pixel_data))
                
                # llamar a la función C++ correspondiente de la DLL
                result_code = -1 
                
                if herramienta_actual == "pincel_trazo":
                    path_str = ";".join([f"{int(p1[0])},{int(p1[1])},{int(p2[0])},{int(p2[1])}" for i, p1 in enumerate(datos_recibidos.get('path', [])[:-1]) for p2 in [datos_recibidos.get('path', [])[i+1]]])
                    color_hex = datos_recibidos.get('color', '000000')
                    size = datos_recibidos.get('size', 5)
                    result_code = paint_lib.dibujar_trazo_pincel(ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)), width, height, path_str.encode('utf-8'), color_hex.encode('utf-8'), size)
                elif herramienta_actual == "borrador_trazo":
                    path_str = ";".join([f"{int(p1[0])},{int(p1[1])},{int(p2[0])},{int(p2[1])}" for i, p1 in enumerate(datos_recibidos.get('path', [])[:-1]) for p2 in [datos_recibidos.get('path', [])[i+1]]])
                    size = datos_recibidos.get('size', 5)
                    result_code = paint_lib.dibujar_trazo_borrador(ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)), width, height, path_str.encode('utf-8'), size)
                elif herramienta_actual == "bote":
                    color_hex = datos_recibidos.get('color', '000000')
                    result_code = paint_lib.rellenar_area(ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)), width, height, datos_recibidos.get('x'), datos_recibidos.get('y'), color_hex.encode('utf-8'))
                elif herramienta_actual == "linea":
                    color_hex = datos_recibidos.get('color','000000')
                    size = datos_recibidos.get('size',1)
                    result_code = paint_lib.dibujar_linea(ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)), width, height, datos_recibidos.get('x1'), datos_recibidos.get('y1'), datos_recibidos.get('x2'), datos_recibidos.get('y2'), color_hex.encode('utf-8'), size)
                elif herramienta_actual == "rectangulo":
                    color_borde_hex = datos_recibidos.get('color','000000')
                    size = datos_recibidos.get('size',1)
                    con_relleno = datos_recibidos.get('conRelleno', False)
                    color_relleno_hex = datos_recibidos.get('colorRelleno', 'FFFFFF') if con_relleno else ""
                    result_code = paint_lib.dibujar_rectangulo(ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)), width, height, datos_recibidos.get('x1'), datos_recibidos.get('y1'), datos_recibidos.get('x2'), datos_recibidos.get('y2'), color_borde_hex.encode('utf-8'), size, con_relleno, color_relleno_hex.encode('utf-8'))

                # Procesar el resultado de la llamada a la DLL
                if result_code == 0:
                    modified_img_rgba = Image.frombytes('RGBA', (width, height), buffer.raw)
                    modified_img_rgb = modified_img_rgba.convert('RGB')
                    output_buffer_ppm = io.BytesIO()
                    modified_img_rgb.save(output_buffer_ppm, format='PPM')
                    new_ppm_data_to_return = output_buffer_ppm.getvalue()
                    
                    # Guardar el nuevo estado en BD
                    max_version_in_db = CanvasState.objects.filter(drawing_id=drawing_id).aggregate(Max('version')).get('version__max')
                    if max_version_in_db is not None and current_version_ptr < max_version_in_db:
                        CanvasState.objects.filter(drawing_id=drawing_id, version__gt=current_version_ptr).delete()
                        print(f"[VIEWS_PY] Historial futuro eliminado para {drawing_id} después de v{current_version_ptr}")
                    
                    new_version = current_version_ptr + 1
                    CanvasState.objects.create(drawing_id=drawing_id, version=new_version, image_data_ppm=new_ppm_data_to_return)
                    request.session['current_version_pointer'] = new_version
                    current_version_ptr = new_version 
                    print(f"[VIEWS_PY] Nuevo estado {drawing_id} v{new_version} guardado en BD.")

                    states_count = CanvasState.objects.filter(drawing_id=drawing_id).count()
                    if states_count > MAX_HISTORY_SIZE:
                        num_to_delete = states_count - MAX_HISTORY_SIZE
                        oldest_states_pks = CanvasState.objects.filter(drawing_id=drawing_id).order_by('version').values_list('pk', flat=True)[:num_to_delete]
                        CanvasState.objects.filter(pk__in=list(oldest_states_pks)).delete()
                        print(f"[VIEWS_PY] Eliminados {num_to_delete} estados antiguos por límite.")
                else:
                    return JsonResponse({'error': f'La operación de dibujo C++ ({herramienta_actual}) falló con código de error {result_code}'}, status=500)
            
            except Exception as e_dll_call:
                print(f"[VIEWS_PY] Error durante la llamada a la DLL C++ o procesando su resultado: {e_dll_call}")
                traceback.print_exc()
                return JsonResponse({'error': f'Error interno del servidor al interactuar con el núcleo de dibujo: {str(e_dll_call)}'}, status=500)

        elif herramienta_actual == "get_initial_canvas":
            new_ppm_data_to_return = current_ppm_data
            datos_respuesta['message'] = "Lienzo inicial cargado."
        
        elif herramienta_actual == "nuevo":
            if 'current_drawing_id' in request.session: del request.session['current_drawing_id']
            if 'current_version_pointer' in request.session: del request.session['current_version_pointer']
            request.session.modified = True
            drawing_id, current_version_ptr, new_ppm_data_to_return = get_or_create_drawing_session(request, width=datos_recibidos.get('width', 800), height=datos_recibidos.get('height', 600), color_hex=datos_recibidos.get('color', "FFFFFF"))
            if not new_ppm_data_to_return: return JsonResponse({'error': 'Fallo al crear nuevo lienzo en BD.'}, status=500)
            datos_respuesta['message'] = 'Lienzo nuevo creado y historial reiniciado.'

        elif herramienta_actual == "deshacer":
            if current_version_ptr > 0:
                current_version_ptr -= 1
                request.session['current_version_pointer'] = current_version_ptr
                try:
                    state_to_restore = CanvasState.objects.get(drawing_id=drawing_id, version=current_version_ptr)
                    new_ppm_data_to_return = state_to_restore.image_data_ppm
                    datos_respuesta['message'] = 'Deshacer aplicado.'
                except CanvasState.DoesNotExist: return JsonResponse({'error': 'Estado de historial para deshacer no encontrado.'}, status=404)
            else:
                datos_respuesta['message'] = 'No hay más acciones para deshacer.'
                new_ppm_data_to_return = current_ppm_data
        
        elif herramienta_actual == "rehacer":
            max_version_for_drawing = CanvasState.objects.filter(drawing_id=drawing_id).count() - 1
            if current_version_ptr < max_version_for_drawing:
                current_version_ptr += 1
                request.session['current_version_pointer'] = current_version_ptr
                try:
                    state_to_restore = CanvasState.objects.get(drawing_id=drawing_id, version=current_version_ptr)
                    new_ppm_data_to_return = state_to_restore.image_data_ppm
                    datos_respuesta['message'] = 'Rehacer aplicado.'
                except CanvasState.DoesNotExist: return JsonResponse({'error': 'Estado de historial para rehacer no encontrado.'}, status=404)
            else:
                datos_respuesta['message'] = 'No hay más acciones para rehacer.'
                new_ppm_data_to_return = current_ppm_data
        
        else:
            return JsonResponse({'error': f'Herramienta desconocida: {herramienta_actual}'}, status=400)

        max_v_db = CanvasState.objects.filter(drawing_id=drawing_id).aggregate(Max('version')).get('version__max', -1)
        if max_v_db is None: max_v_db = -1
        datos_respuesta['can_undo'] = current_version_ptr > 0
        datos_respuesta['can_redo'] = current_version_ptr < max_v_db
        request.session.modified = True

        # Devolver la imagen y el estado del historial
        if new_ppm_data_to_return:
            url_imagen = convertir_ppm_bytes_a_png_base64(new_ppm_data_to_return)
            if url_imagen:
                datos_respuesta['image_data_url'] = url_imagen
            else:
                datos_respuesta['error'] = datos_respuesta.get('error', 'No se pudo convertir la imagen del servidor.')
                return JsonResponse(datos_respuesta, status=500)
        else:
            datos_respuesta['error'] = datos_respuesta.get('error', 'No se generaron datos de imagen para devolver.')
            return JsonResponse(datos_respuesta, status=500)
            
        if 'error' not in datos_respuesta:
             if herramienta_actual not in ['get_initial_canvas', 'set_base_image']:
                 datos_respuesta['message'] = datos_respuesta.get('message', f'Operación "{herramienta_actual}" aplicada.')
        
        return JsonResponse(datos_respuesta)

    except json.JSONDecodeError:
        return JsonResponse({'error': 'Petición JSON inválida'}, status=400)
    except Exception as e:
        print(f"[VIEWS_PY] Error MUY inesperado en la API de dibujo: {e}")
        traceback.print_exc()
        return JsonResponse({'error': f'Error interno del servidor: {str(e)}'}, status=500)