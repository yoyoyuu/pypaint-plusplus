# paint_app/urls.py
from django.urls import path
from . import views 

app_name = 'paint_app'

urlpatterns = [
    # urls de la app
    path('', views.vista_pagina_paint, name='vista_paint'), # página principal
    path('api/dibujo/', views.vista_api_dibujo, name='api_dibujo'), # API de dibujo
]