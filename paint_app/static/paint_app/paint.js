// paint_app/static/paint_app/paint.js

const DEFAULT_CANVAS_WIDTH = 800;
const DEFAULT_CANVAS_HEIGHT = 600;

document.addEventListener('DOMContentLoaded', () => {
    // --- Elementos del DOM ---

    const canvas = document.getElementById('drawingCanvas');
    if (!canvas) {
        console.error("FATAL: Elemento canvas con ID 'drawingCanvas' no encontrado.");
        alert("Error crítico: No se pudo inicializar el área de dibujo. Verifica el ID del canvas en tu HTML.");
        return;
    }

    // --- Contexto de dibujo ---

    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // --- Referencias a elementos del DOM ---

    const toolButtons = document.querySelectorAll('.tool-button');
    const colorPicker = document.getElementById('colorPicker');
    const sizeInput = document.getElementById('sizeInput');

    const rectanguloOptions = document.getElementById('rectanguloOptions');
    const fillCheckbox = document.getElementById('fillCheckbox');
    const fillColorDiv = document.getElementById('fillColorDiv');
    const fillColorPicker = document.getElementById('fillColorPicker');

    const nuevoOptions = document.getElementById('nuevoOptions');
    const newWidthInput = document.getElementById('newWidthInput');
    const newHeightInput = document.getElementById('newHeightInput');
    const newColorInput = document.getElementById('newColorInput');
    const createCanvasBtn = document.getElementById('createCanvasBtn');

    const saveDrawingBtn = document.getElementById('saveDrawingBtn');
    const statusMessage = document.getElementById('statusMessage');
    const loadingIndicator = document.getElementById('loadingIndicator');

    const undoButton = document.getElementById('undoButton');
    const redoButton = document.getElementById('redoButton');

    const colorPickerWrapper = document.querySelector('#generalOptions .color-picker-wrapper');
    const fillColorPickerWrapper = document.querySelector('#rectanguloOptions .color-picker-wrapper');
    const newColorPickerWrapper = document.querySelector('#nuevoOptions .color-picker-wrapper');

    // --- Variables de estado ---
    let currentTool = 'pincel_trazo';
    let currentColor = colorPicker ? colorPicker.value : '#000000';
    let currentSize = sizeInput ? parseInt(sizeInput.value) : 5;
    let isDrawing = false;
    let startX, startY;
    let lastX, lastY;
    let pathPoints = [];

    let currentFill = fillCheckbox ? fillCheckbox.checked : false;
    let currentFillColor = fillColorPicker ? fillColorPicker.value : '#FFFFFF';

    let serverImage = new Image();

    let historyStack = [];
    let historyPointer = -1;
    const MAX_HISTORY_STATES = 20;

    function saveCanvasState() {
        if (canvas.width === 0 || canvas.height === 0) return;
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        if (historyPointer < historyStack.length - 1) {
            historyStack = historyStack.slice(0, historyPointer + 1);
        }
        historyStack.push(imageData);
        if (historyStack.length > MAX_HISTORY_STATES) {
            historyStack.shift();
        }
        historyPointer = historyStack.length - 1;

        console.log(`Estado guardado. Puntero: ${historyPointer}, Longitud: ${historyStack.length}`);
        updateUndoRedoButtons();
    }

    function restoreCanvasState(pointer) {
        if (pointer < 0 || pointer >= historyStack.length) return;
        const imageDataToRestore = historyStack[pointer];

        if (canvas.width !== imageDataToRestore.width || canvas.height !== imageDataToRestore.height) {
            canvas.width = imageDataToRestore.width;
            canvas.height = imageDataToRestore.height;
        }
        ctx.putImageData(imageDataToRestore, 0, 0);
        historyPointer = pointer;
        updateUndoRedoButtons();
    }

    function undo() {
        if (historyPointer > 0) {
            restoreCanvasState(historyPointer - 1);
            setStatusMessage('Acción deshecha.');
        }
    }

    function redo() {
        if (historyPointer < historyStack.length - 1) {
            restoreCanvasState(historyPointer + 1);
            setStatusMessage('Acción rehecha.');
        }
    }

    function updateUndoRedoButtons() {
        if (undoButton) undoButton.disabled = historyPointer <= 0;
        if (redoButton) redoButton.disabled = historyPointer >= historyStack.length - 1;
    }

    // --- Eventos ---

    // Evento de carga de la imagen del servidor
    serverImage.onload = () => {
        console.log("🎨 [Frontend] serverImage.onload: Imagen del servidor cargada/actualizada.");
        if (serverImage.naturalWidth > 0 && serverImage.naturalHeight > 0) {
            if (canvas.width !== serverImage.naturalWidth || canvas.height !== serverImage.naturalHeight) {
                console.log(`🎨 [Frontend] Redimensionando canvas: ${canvas.width}x${canvas.height} -> ${serverImage.naturalWidth}x${serverImage.naturalHeight}`);
                canvas.width = serverImage.naturalWidth;
                canvas.height = serverImage.naturalHeight;
            }
        } else {
            console.warn("⚠️ [Frontend] serverImage.onload: naturalWidth o naturalHeight es 0. No se redimensiona canvas.");
            if (canvas.width === 0 || canvas.height === 0) { // Si el canvas no tiene tamaño, establecer uno
                canvas.width = newWidthInput ? (parseInt(newWidthInput.value) || DEFAULT_CANVAS_WIDTH) : DEFAULT_CANVAS_WIDTH;
                canvas.height = newHeightInput ? (parseInt(newHeightInput.value) || DEFAULT_CANVAS_HEIGHT) : DEFAULT_CANVAS_HEIGHT;
            }
        }
        redrawCanvasBase();
        hideLoading();
    };

    serverImage.onerror = (e) => {
        console.error(" [Frontend] serverImage.onerror: Error cargando imagen del servidor:", e);
        setStatusMessage("Error crítico: No se pudo cargar la imagen del servidor.", true);
        hideLoading();
        // Fallback: dibujar un lienzo en blanco con dimensiones por defecto
        canvas.width = newWidthInput ? (parseInt(newWidthInput.value) || DEFAULT_CANVAS_WIDTH) : DEFAULT_CANVAS_WIDTH;
        canvas.height = newHeightInput ? (parseInt(newHeightInput.value) || DEFAULT_CANVAS_HEIGHT) : DEFAULT_CANVAS_HEIGHT;
        const bgColor = newColorInput ? (newColorInput.value || '#FFFFFF') : '#FFFFFF';
        ctx.fillStyle = bgColor; ctx.fillRect(0, 0, canvas.width, canvas.height);
        updateHistoryButtonsUI(false, false); // Deshabilitar en error de carga
    };

    // --- Funciones apoyo ---

    // Obtiene el valor de una cookie por su nombre
    function getCookie(name) {
        let cookieValue = null;
        if (document.cookie && document.cookie !== '') {
            const cookies = document.cookie.split(';');
            for (let i = 0; i < cookies.length; i++) {
                const cookie = cookies[i].trim();
                if (cookie.substring(0, name.length + 1) === (name + '=')) {
                    cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                    break;
                }
            }
        }
        return cookieValue;
    }

    // Actualiza el mensaje de estado
    function setStatusMessage(message, isError = false) {
        if (statusMessage) {
            statusMessage.textContent = message;
            statusMessage.classList.remove('error', 'success');
            statusMessage.className = isError ? 'status-message error' : 'status-message success';
            clearTimeout(statusMessage.timeoutId);
            statusMessage.timeoutId = setTimeout(() => {
                statusMessage.textContent = '';
                statusMessage.className = 'status-message';
            }, 5000);
        }
    }

    // Muestra o oculta el indicador de carga
    function showLoading() { if (loadingIndicator) loadingIndicator.style.display = 'block'; }
    function hideLoading() { if (loadingIndicator) loadingIndicator.style.display = 'none'; }

    // Oculta todos los paneles de opciones especiales
    function hideAllSpecificOptions() {
        document.querySelectorAll('.specific-options').forEach(panel => panel.style.display = 'none');
        const generalOpts = document.getElementById('generalOptions');
        if (generalOpts) generalOpts.style.display = 'block';
    }

    // Actualiza el color del wrapper de un color picker
    function updateColorPickerWrapper(inputElement, wrapperElement) {
        if (wrapperElement && inputElement) {
            wrapperElement.style.backgroundColor = inputElement.value;
        }
    }

    // Actualiza el estado de los botones de historial (Deshacer/Rehacer)
    function updateHistoryButtonsUI(canUndo, canRedo) {
        if (undoButton) undoButton.disabled = !canUndo;
        if (redoButton) redoButton.disabled = !canRedo;
        console.log(`🎨 [Frontend] Botones de historial UI actualizados: Deshacer: ${undoButton ? !undoButton.disabled : 'N/A'}, Rehacer: ${redoButton ? !redoButton.disabled : 'N/A'}`);
    }

    // Dibuja la imagen base del servidor
    function redrawCanvasBase() {
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (serverImage.src && serverImage.complete && serverImage.naturalWidth > 0) {
            ctx.drawImage(serverImage, 0, 0, canvas.width, canvas.height);
        } else {
            const bgColor = newColorInput ? (newColorInput.value || '#FFFFFF') : '#FFFFFF';
            ctx.fillStyle = bgColor;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
    }

    // Dibuja la previsualización encima
    function redrawCanvasWithPreview(tempDrawCallback) {
        if (!ctx) return;
        redrawCanvasBase();
        if (tempDrawCallback && typeof tempDrawCallback === 'function') {
            ctx.save();
            tempDrawCallback(ctx);
            ctx.restore();
        }
    }

    // Envía el dibujo al backend
    async function sendDrawingCommand(data) {
        showLoading();
        setStatusMessage('');
        console.log("➡️ [Frontend] Enviando al backend:", data);

        const csrftoken = getCookie('csrftoken');
        if (!csrftoken) {
            setStatusMessage("Error: Token CSRF no encontrado.", true);
            hideLoading();
            updateHistoryButtonsUI(false, false);
            return;
        }

        try {
            const response = await fetch('/paint/api/dibujo/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrftoken, },
                body: JSON.stringify(data),
            });
            const textResult = await response.text();
            const contentType = response.headers.get("content-type");

            if (response.ok) {
                let result = {};
                if (contentType && contentType.includes("application/json")) {
                    try {
                        result = JSON.parse(textResult);
                        console.log("[Frontend] Respuesta JSON del backend (OK):", result);

                        if (result.image_data_url) {
                            console.log("[Frontend] Recibido image_data_url. Actualizando serverImage.src.");
                            serverImage.src = result.image_data_url;
                        } else if (data.tool === 'get_initial_canvas' && !result.image_data_url) {
                            console.warn("[Frontend] get_initial_canvas no devolvió image_data_url. Usando lienzo por defecto/limpio.");
                            redrawCanvasBase();
                            hideLoading();
                        }

                        if (result.message) { setStatusMessage(result.message); }

                        // Actualizar botones de historial con la respuesta del servidor
                        updateHistoryButtonsUI(result.can_undo === true, result.can_redo === true);

                    } catch (e) {
                        console.error(" [Frontend] Error parseando JSON de respuesta OK:", e, "Texto:", textResult.substring(0, 200));
                        setStatusMessage(`Respuesta OK, pero error procesando datos del servidor.`, true);
                        hideLoading();
                        updateHistoryButtonsUI(false, false);
                    }
                } else {
                    console.warn("[Frontend] Respuesta OK pero no JSON:", response.status, textResult.substring(0, 200));
                    setStatusMessage(`Comando "${data.tool}" enviado (Respuesta no JSON).`);
                    hideLoading();
                    updateHistoryButtonsUI(false, false);
                }
            } else {
                console.error(" [Frontend] Respuesta del backend (Error):", response.status, textResult.substring(0, 500));
                let errorMsg = `Error del servidor (${response.status}).`;
                if (contentType && contentType.includes("application/json")) {
                    try {
                        const errResult = JSON.parse(textResult);
                        errorMsg = errResult.error || errorMsg;
                        updateHistoryButtonsUI(errResult.can_undo === true, errResult.can_redo === true);
                    }
                    catch (e) {
                        console.error(" [Frontend] Error parseando JSON de error:", e);
                        updateHistoryButtonsUI(false, false);
                    }
                } else {
                    updateHistoryButtonsUI(false, false);
                }
                setStatusMessage(errorMsg, true);
                hideLoading();
            }
        } catch (error) {
            console.error('[Frontend] Error en fetch:', error);
            setStatusMessage(`Error de comunicación: ${error.message}`, true);
            hideLoading();
            updateHistoryButtonsUI(false, false);
        }
    }

    // Solicita el lienzo inicial y el estado del historial al backend
    function fetchInitialCanvas() {
        console.log("➡️ [Frontend] Solicitando lienzo inicial y estado de historial...");
        sendDrawingCommand({
            tool: 'get_initial_canvas',
            width: canvas.width || DEFAULT_CANVAS_WIDTH,
            height: canvas.height || DEFAULT_CANVAS_HEIGHT,
            color: newColorInput ? (newColorInput.value.substring(1) || 'FFFFFF') : 'FFFFFF'
        });
    }

    // --- Event Handlers ---

    // Maneja el cambio de herramienta y actualiza las opciones específicas
    function handleToolChange() {
        const activeToolButton = document.querySelector('.tool-button.active');
        if (activeToolButton && activeToolButton.dataset.tool) {
            currentTool = activeToolButton.dataset.tool;
        }

        console.log("🎨 [Frontend] handleToolChange. Herramienta actual:", currentTool);
        hideAllSpecificOptions();

        if (currentTool === 'rectangulo' && rectanguloOptions) {
            rectanguloOptions.style.display = 'block';
            const generalOpts = document.getElementById('generalOptions');
            if (generalOpts) generalOpts.style.display = 'block';
        } else if (currentTool === 'mostrar_nuevo_lienzo' && nuevoOptions) {
            nuevoOptions.style.display = 'block';
            const generalOpts = document.getElementById('generalOptions');
            if (generalOpts) generalOpts.style.display = 'none';
        } else if (['pincel_trazo', 'borrador_trazo', 'bote', 'linea'].includes(currentTool)) {
            const generalOpts = document.getElementById('generalOptions');
            if (generalOpts) generalOpts.style.display = 'block';
        }

        // Actualizar el mensaje de estado solo si es una herramienta de dibujo
        if (currentTool && !currentTool.startsWith('mostrar_') && activeToolButton && activeToolButton.dataset.tool) {
            setStatusMessage(`Herramienta: ${activeToolButton.textContent}`);
        }
    }

    // Asignar eventos a los botones de herramientas
    toolButtons.forEach(button => {
        button.addEventListener('click', () => {
            const toolFromButton = button.dataset.tool;
            if (toolFromButton && toolFromButton !== 'deshacer' && toolFromButton !== 'rehacer') {
                toolButtons.forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                handleToolChange();
            }
        });
    });

    // Maneja el evento de cambio de color de pincel
    if (colorPicker) {
        colorPicker.addEventListener('input', (e) => {
            currentColor = e.target.value;
            if (colorPickerWrapper) updateColorPickerWrapper(colorPicker, colorPickerWrapper);
        });
        if (colorPickerWrapper) colorPickerWrapper.addEventListener('click', () => colorPicker.click());
        if (colorPicker) colorPicker.addEventListener('click', (e) => e.stopPropagation());
    }

    // Maneja el evento de cambio de grosor de pincel
    if (sizeInput) {
        sizeInput.addEventListener('input', (e) => {
            currentSize = parseInt(e.target.value);
            if (isNaN(currentSize) || currentSize < 1) currentSize = 1;
            else if (currentSize > 100) currentSize = 100;
            sizeInput.value = currentSize;
        });
    }

    // Maneja el evento de cambio de opciones de rectángulo
    if (fillCheckbox) {
        fillCheckbox.addEventListener('change', (e) => {
            currentFill = e.target.checked;
            if (fillColorDiv) fillColorDiv.style.display = currentFill ? 'block' : 'none';
        });
        if (fillColorDiv && fillCheckbox) fillColorDiv.style.display = fillCheckbox.checked ? 'block' : 'none';
    }

    // Maneja el evento de cambio de color de relleno
    if (fillColorPicker) {
        fillColorPicker.addEventListener('input', (e) => {
            currentFillColor = e.target.value;
            if (fillColorPickerWrapper) updateColorPickerWrapper(fillColorPicker, fillColorPickerWrapper);
        });
        if (fillColorPickerWrapper) fillColorPickerWrapper.addEventListener('click', () => fillColorPicker.click());
        if (fillColorPicker) fillColorPicker.addEventListener('click', (e) => e.stopPropagation());
    }

    // Maneja el evento de cambio de opciones de nuevo lienzo
    if (newColorInput) {
        newColorInput.addEventListener('input', (e) => {
            if (newColorPickerWrapper) updateColorPickerWrapper(newColorInput, newColorPickerWrapper);
        });
        if (newColorPickerWrapper) newColorPickerWrapper.addEventListener('click', () => newColorInput.click());
        if (newColorInput) newColorInput.addEventListener('click', (e) => e.stopPropagation());
    }

    // Maneja el evento de creación de un nuevo lienzo
    if (createCanvasBtn) {
        createCanvasBtn.addEventListener('click', () => {
            const width = newWidthInput ? (parseInt(newWidthInput.value) || DEFAULT_CANVAS_WIDTH) : DEFAULT_CANVAS_WIDTH;
            const height = newHeightInput ? (parseInt(newHeightInput.value) || DEFAULT_CANVAS_HEIGHT) : DEFAULT_CANVAS_HEIGHT;
            const color = newColorInput ? newColorInput.value : '#FFFFFF';

            if (isNaN(width) || width < 100 || isNaN(height) || height < 100) {
                setStatusMessage("Ancho y Alto deben ser números mayores o iguales a 100.", true); return;
            }
            sendDrawingCommand({ tool: 'nuevo', width: width, height: height, color: color.substring(1) });

            if (nuevoOptions) nuevoOptions.style.display = 'none';
            const generalOpts = document.getElementById('generalOptions');
            if (generalOpts) generalOpts.style.display = 'block';

            const defaultToolButton = document.querySelector('.tool-button[data-tool="pincel_trazo"]');
            if (defaultToolButton) {
                toolButtons.forEach(btn => btn.classList.remove('active'));
                defaultToolButton.classList.add('active');
                currentTool = defaultToolButton.dataset.tool; // Actualizar herramienta global
                handleToolChange(); // Actualizar UI de opciones
            }
        });
    }

    // Maneja el evento de guardar dibujo
    if (saveDrawingBtn) {

        saveDrawingBtn.addEventListener('click', () => {
            if (!canvas || (canvas.width === 0 && canvas.height === 0)) {
                setStatusMessage("No hay nada que guardar. El lienzo está vacío o no inicializado.", true);
                console.warn("⚠️ [Frontend] Intento de guardar lienzo no inicializado o vacío.");
                return;
            }
            if (!serverImage.src || !serverImage.complete || serverImage.naturalWidth === 0) {
                console.warn("⚠️ [Frontend] Guardando el estado actual del canvas, pero serverImage podría no estar completamente cargada o es el estado inicial.");
            }

            try {
                const dataURL = canvas.toDataURL('image/png');

                const link = document.createElement('a');
                link.download = 'mi_dibujo.png'; // Nombre por defecto del archivo de descarga.
                link.href = dataURL; // La URL de datos como destino del enlace.

                // Añadir el enlace al DOM, hacer clic y luego removerlo (necesario para Firefox).
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);

                setStatusMessage('Dibujo guardado como mi_dibujo.png');
                console.log("[Frontend] Dibujo guardado localmente.");
            } catch (error) {
                console.error(" [Frontend] Error al intentar guardar el dibujo:", error);
                setStatusMessage("Error al guardar el dibujo. El lienzo podría ser demasiado grande o estar 'tainted'.", true);
            }
        });
    }

    // Event Listeners para Deshacer y Rehacer 
    if (undoButton) undoButton.addEventListener('click', () => {
        console.log("➡️ [Frontend] Clic en Deshacer.");
        sendDrawingCommand({ tool: 'deshacer' });
    });

    if (redoButton) redoButton.addEventListener('click', () => {
        console.log("➡️ [Frontend] Clic en Rehacer.");
        sendDrawingCommand({ tool: 'rehacer' });
    });

    // --- Eventos de Puntero (para Ratón, Lápiz y Táctil) ---

    // Evento de inicio de dibujo
    canvas.addEventListener('pointerdown', (e) => {
        if ((e.pointerType !== 'mouse' && e.pointerType !== 'pen') ||
            !['pincel_trazo', 'borrador_trazo', 'bote', 'linea', 'rectangulo'].includes(currentTool)) {
            return;
        }

        const rect = canvas.getBoundingClientRect();
        const x = Math.floor(e.clientX - rect.left);
        const y = Math.floor(e.clientY - rect.top);
        if (x < 0 || x >= canvas.width || y < 0 || y >= canvas.height) return;

        isDrawing = true;
        canvas.setPointerCapture(e.pointerId);

        startX = x; startY = y; lastX = x; lastY = y;

        if (['pincel_trazo', 'borrador_trazo'].includes(currentTool)) {
            pathPoints = [[x, y]];
            redrawCanvasWithPreview((previewCtx) => {
                previewCtx.strokeStyle = currentTool === 'pincel_trazo' ? currentColor : '#FFFFFF';
                previewCtx.lineWidth = currentSize;
                previewCtx.lineCap = 'round'; previewCtx.lineJoin = 'round';
                previewCtx.beginPath();
                const cX = Math.max(0, Math.min(canvas.width - 1, x));
                const cY = Math.max(0, Math.min(canvas.height - 1, y));
                previewCtx.arc(cX, cY, currentSize / 2, 0, Math.PI * 2);
                previewCtx.fillStyle = currentTool === 'pincel_trazo' ? currentColor : '#FFFFFF';
                previewCtx.fill();
            });
        } else if (currentTool === 'bote') {
            sendDrawingCommand({ tool: 'bote', x: x, y: y, color: currentColor.substring(1) });
            isDrawing = false;
        }
        if (currentTool !== 'bote') e.preventDefault();
    });

    // Evento de movimiento del puntero mientras se dibuja
    // paint.js

    // ... (El resto del código) ...

    // Evento de movimiento del puntero mientras se dibuja
    canvas.addEventListener('pointermove', (e) => {
        if (!isDrawing || currentTool === 'bote') return;

        const rect = canvas.getBoundingClientRect();
        const x = Math.floor(e.clientX - rect.left);
        const y = Math.floor(e.clientY - rect.top);

        const clampedX = Math.max(0, Math.min(canvas.width - 1, x));
        const clampedY = Math.max(0, Math.min(canvas.height - 1, y));

        // Lógica de Presión (Restaurada)
        let pressure = e.pressure !== undefined ? e.pressure : 0.5;
        if (e.pointerType === 'pen' && pressure < 0.01) pressure = 0.01; // Mínimo para el lápiz

        // Cálculo del tamaño dinámico
        let dynamicSize = Math.max(1, currentSize * pressure);

        if (['pincel_trazo', 'borrador_trazo'].includes(currentTool)) {
            if (x >= 0 && x < canvas.width && y >= 0 && y < canvas.height) {
                const lastP = pathPoints.length > 0 ? pathPoints[pathPoints.length - 1] : null;
                if (!lastP || (clampedX - lastP[0]) ** 2 + (clampedY - lastP[1]) ** 2 >= 4) {
                    // Guardar coordenadas Y el tamaño dinámico para el trazo variable
                    pathPoints.push([clampedX, clampedY, dynamicSize]); // [x, y, size]
                }
            }
            if (pathPoints.length > 0) {
                // Lógica de previsualización para trazos con tamaño dinámico
                redrawCanvasWithPreview((previewCtx) => {
                    previewCtx.strokeStyle = currentTool === 'pincel_trazo' ? currentColor : '#FFFFFF';
                    previewCtx.lineCap = 'round';
                    previewCtx.lineJoin = 'round';

                    if (pathPoints.length > 1) {
                        // Dibujo por segmentos para manejar el cambio de grosor
                        for (let i = 1; i < pathPoints.length; i++) {
                            const p1 = pathPoints[i - 1];
                            const p2 = pathPoints[i];

                            previewCtx.lineWidth = p1[2]; // Usar el tamaño del punto anterior
                            previewCtx.beginPath();
                            previewCtx.moveTo(p1[0], p1[1]);
                            previewCtx.lineTo(p2[0], p2[1]);
                            previewCtx.stroke();
                        }
                    } else if (pathPoints.length === 1) {
                        // Dibujar el punto inicial
                        previewCtx.lineWidth = pathPoints[0][2];
                        previewCtx.beginPath();
                        previewCtx.arc(pathPoints[0][0], pathPoints[0][1], pathPoints[0][2] / 2, 0, Math.PI * 2);
                        previewCtx.fillStyle = currentTool === 'pincel_trazo' ? currentColor : '#FFFFFF';
                        previewCtx.fill();
                    }
                });
            }
        } else if (['linea', 'rectangulo'].includes(currentTool)) {
            redrawCanvasWithPreview((previewCtx) => {
                previewCtx.strokeStyle = currentColor;
                previewCtx.lineWidth = currentSize; // Usar tamaño fijo
                const currentDrawX = clampedX;
                const currentDrawY = clampedY;

                if (currentTool === 'linea') {
                    previewCtx.beginPath();
                    previewCtx.moveTo(startX, startY);
                    previewCtx.lineTo(currentDrawX, currentDrawY);
                    previewCtx.stroke();
                } else if (currentTool === 'rectangulo') {
                    const rectStartX = Math.min(startX, currentDrawX);
                    const rectStartY = Math.min(startY, currentDrawY);
                    const rectWidth = Math.abs(currentDrawX - startX);
                    const rectHeight = Math.abs(currentDrawY - startY);

                    if (fillCheckbox && fillCheckbox.checked && fillColorPicker) {
                        previewCtx.fillStyle = fillColorPicker.value;
                        previewCtx.fillRect(rectStartX, rectStartY, rectWidth, rectHeight);
                    }
                    previewCtx.strokeRect(rectStartX, rectStartY, rectWidth, rectHeight);
                }
            });
        }
        lastX = clampedX;
        lastY = clampedY;
    });

    canvas.addEventListener('pointerup', (e) => {
        // 1. Verificación Inicial y Finalización
        if (!isDrawing) return; // Si no estábamos dibujando (ya sea por un evento pointerout que no finalizó correctamente o una doble pulsación)

        // Para 'bote', la acción ya se envió en pointerdown, solo liberamos la captura
        if (currentTool === 'bote') {
            canvas.releasePointerCapture(e.pointerId);
            isDrawing = false;
            return;
        }

        // Liberar la captura del puntero y detener el flag de dibujo
        canvas.releasePointerCapture(e.pointerId);
        isDrawing = false;

        // Obtener y restringir coordenadas finales
        const rect = canvas.getBoundingClientRect();
        const endX = Math.floor(e.clientX - rect.left);
        const endY = Math.floor(e.clientY - rect.top);
        const clampedEndX = Math.max(0, Math.min(canvas.width - 1, endX));
        const clampedEndY = Math.max(0, Math.min(canvas.height - 1, endY));

        let actionToSend = null;

        // Lógica para Pincel/Borrador (Trazos)
        if (['pincel_trazo', 'borrador_trazo'].includes(currentTool)) {
            // --- Lógica de Presión para el Punto Final ---
            const lastPressure = e.pressure !== undefined ? e.pressure : 0.5;
            const lastDynamicSize = Math.max(1, currentSize * lastPressure);

            // Añadir el último punto del arrastre si es diferente
            if (endX >= 0 && endX < canvas.width && endY >= 0 && endY < canvas.height) {
                const lastP = pathPoints.length > 0 ? pathPoints[pathPoints.length - 1] : null;
                if (!lastP || (clampedEndX - lastP[0]) ** 2 + (clampedEndY - lastP[1]) ** 2 > 0) {
                    // [x, y, size]
                    pathPoints.push([clampedEndX, clampedEndY, lastDynamicSize]);
                }
            }

            if (pathPoints.length > 0) {
                // 1. Limpiar la previsualización restaurando el estado anterior del historial
                if (historyStack[historyPointer]) {
                    ctx.putImageData(historyStack[historyPointer], 0, 0);
                }

                // 2. Dibujar el trazo final permanentemente (con grosor dinámico)
                if (pathPoints.length > 1) {
                    // Dibujar segmento por segmento para manejar el cambio de grosor
                    for (let i = 1; i < pathPoints.length; i++) {
                        const p1 = pathPoints[i - 1];
                        const p2 = pathPoints[i];

                        ctx.strokeStyle = currentTool === 'pincel_trazo' ? currentColor : '#FFFFFF';
                        ctx.lineWidth = p1[2]; // Usar el tamaño dinámico del punto anterior
                        ctx.beginPath();
                        ctx.moveTo(p1[0], p1[1]);
                        ctx.lineTo(p2[0], p2[1]);
                        ctx.stroke();
                    }
                } else if (pathPoints.length === 1) {
                    // Dibujar un punto grueso
                    ctx.lineWidth = pathPoints[0][2];
                    ctx.beginPath();
                    ctx.arc(pathPoints[0][0], pathPoints[0][1], pathPoints[0][2] / 2, 0, Math.PI * 2);
                    ctx.fillStyle = currentTool === 'pincel_trazo' ? currentColor : '#FFFFFF';
                    ctx.fill();
                }

                // 3. Preparar la acción para el servidor (SOLO COORDENADAS)
                // C++ no maneja el grosor dinámico, así que le enviamos el grosor fijo
                // o el grosor MÁXIMO/PROMEDIO, pero por simplicidad, enviamos el grosor fijo de la UI.
                const pathCoordsOnly = pathPoints.map(p => [p[0], p[1]]);
                actionToSend = { tool: currentTool, path: pathCoordsOnly, size: currentSize }; // currentSize es el valor del input
                if (currentTool === 'pincel_trazo') { actionToSend.color = currentColor.substring(1); }
            } else {
                redrawCanvasBase(); // Limpiar previsualización (si solo se dibujó un punto y no se envió)
                setStatusMessage("Trazo muy corto, no enviado.");
                pathPoints = []; // Limpiar pathPoints y salir
                return;
            }
            pathPoints = []; // Limpiar pathPoints después de la preparación de la acción

        } else if (['linea', 'rectangulo'].includes(currentTool)) {
            // Lógica para Línea y Rectángulo (Dibujo Fijo)

            // 1. Limpiar la previsualización restaurando el estado anterior del historial
            if (historyStack[historyPointer]) {
                ctx.putImageData(historyStack[historyPointer], 0, 0);
            }

            // 2. Dibujar la figura final permanentemente (sin cambios)
            ctx.strokeStyle = currentColor;
            ctx.lineWidth = currentSize;
            if (currentTool === 'linea') {
                ctx.beginPath(); ctx.moveTo(startX, startY); ctx.lineTo(clampedEndX, clampedEndY); ctx.stroke();
            } else if (currentTool === 'rectangulo') {
                const rectStartX = Math.min(startX, clampedEndX); const rectStartY = Math.min(startY, clampedEndY);
                const rectWidth = Math.abs(clampedEndX - startX); const rectHeight = Math.abs(clampedEndY - startY);
                if (fillCheckbox && fillCheckbox.checked && fillColorPicker) {
                    ctx.fillStyle = fillColorPicker.value;
                    ctx.fillRect(rectStartX, rectStartY, rectWidth, rectHeight);
                }
                ctx.strokeRect(rectStartX, rectStartY, rectWidth, rectHeight);
            }

            // 3. Preparar acción para el servidor
            actionToSend = {
                tool: currentTool, x1: startX, y1: startY, x2: clampedEndX, y2: clampedEndY,
                color: currentColor.substring(1), size: currentSize
            };
            if (currentTool === 'rectangulo' && fillCheckbox) {
                actionToSend.conRelleno = fillCheckbox.checked;
                if (actionToSend.conRelleno && fillColorPicker) {
                    actionToSend.colorRelleno = fillColorPicker.value.substring(1);
                }
            }
        }

        // --- Pasos de Confirmación Optimista Finales ---

        // 4. Guardar INMEDIATAMENTE el nuevo estado en el historial local
        if (actionToSend) { // Solo guardar si realmente se envió algo
            saveCanvasState();
        }

        // 5. Enviar la acción al servidor en segundo plano
        if (actionToSend) {
            sendDrawingCommand(actionToSend);
        }
    });

    // Evento si el puntero sale del canvas
    canvas.addEventListener('pointerout', (e) => {
        if (!isDrawing || currentTool === 'bote') return;

        // Finalizar el dibujo como si fuera un mouseup
        const rect = canvas.getBoundingClientRect();
        const endX = Math.floor(e.clientX - rect.left);
        const endY = Math.floor(e.clientY - rect.top);
        const clampedEndX = Math.max(0, Math.min(canvas.width - 1, endX));
        const clampedEndY = Math.max(0, Math.min(canvas.height - 1, endY));

        canvas.releasePointerCapture(e.pointerId);
        isDrawing = false;

        let actionToSend = null;

        if (['pincel_trazo', 'borrador_trazo'].includes(currentTool)) {
            if (lastX !== undefined && lastY !== undefined && pathPoints.length > 0) {
                const lastP = pathPoints[pathPoints.length - 1];
                if (!lastP || (lastX - lastP[0]) ** 2 + (lastY - lastP[1]) ** 2 > 0) {
                    // Usar la última presión conocida o 0.5
                    const lastPressure = e.pressure !== undefined ? e.pressure : 0.5;
                    const lastDynamicSize = Math.max(1, currentSize * lastPressure);
                    pathPoints.push([lastX, lastY, lastDynamicSize]);
                }
            }
            if (pathPoints.length > 0) {
                const pathCoordsOnly = pathPoints.map(p => [p[0], p[1]]);
                actionToSend = { tool: currentTool, path: pathCoordsOnly, size: currentSize };
                if (currentTool === 'pincel_trazo') {
                    actionToSend.color = currentColor.substring(1);
                }
            } else {
                redrawCanvasBase();
                setStatusMessage("Trazo incompleto, no enviado.");
            }
        } else if (['linea', 'rectangulo'].includes(currentTool)) {
            redrawCanvasBase();
            setStatusMessage("Dibujo de figura cancelado (puntero salió del canvas).");
        }

        if (actionToSend) { sendDrawingCommand(actionToSend); }
        pathPoints = [];
    });

    // --- Setup Inicial ---

    // Inicializa el canvas y carga la imagen del servidor
    function initializeCanvas() {
        console.log("🎨 [Frontend] Inicializando canvas...");
        const initialWidth = newWidthInput ? (parseInt(newWidthInput.value) || DEFAULT_CANVAS_WIDTH) : DEFAULT_CANVAS_WIDTH;
        const initialHeight = newHeightInput ? (parseInt(newHeightInput.value) || DEFAULT_CANVAS_HEIGHT) : DEFAULT_CANVAS_HEIGHT;
        canvas.width = initialWidth; canvas.height = initialHeight;

        const defaultToolButton = document.querySelector('.tool-button[data-tool="pincel_trazo"]');
        if (defaultToolButton) {
            toolButtons.forEach(btn => btn.classList.remove('active'));
            defaultToolButton.classList.add('active');
            currentTool = defaultToolButton.dataset.tool;
        }
        handleToolChange();
        updateHistoryButtonsUI(false, false);
        fetchInitialCanvas();
    }

    initializeCanvas();
});