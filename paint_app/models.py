# paint_app/models.py
from django.db import models
import uuid # Sigue siendo necesario

def generate_drawing_id():
    """Genera un UUID como string para el drawing_id."""
    return str(uuid.uuid4())

class CanvasState(models.Model):
    """
    Representa un estado guardado del lienzo de dibujo.
    Cada instancia es un "memento" de la imagen en un punto del historial.
    """
    drawing_id = models.CharField(
        max_length=100, 
        default=generate_drawing_id, 
        db_index=True,
        help_text="Identificador único para un conjunto de estados de historial de un dibujo."
    )
    version = models.PositiveIntegerField(
        db_index=True,
        help_text="Número de versión secuencial dentro de un drawing_id, representa un paso en el historial."
    )
    image_data_ppm = models.BinaryField(
        help_text="Contenido binario del archivo PPM que representa este estado del lienzo."
    )
    timestamp = models.DateTimeField(
        auto_now_add=True,
        help_text="Fecha y hora en que se guardó este estado."
    )

    class Meta:
        unique_together = ('drawing_id', 'version')
        ordering = ['drawing_id', 'version'] 
        verbose_name = "Estado del Lienzo"
        verbose_name_plural = "Estados del Lienzo"

    def __str__(self):
        return f"Dibujo {self.drawing_id} - Versión {self.version} ({self.timestamp.strftime('%Y-%m-%d %H:%M')})"