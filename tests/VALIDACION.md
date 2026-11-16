# Validación

## Verificada automáticamente

Ejecutar `npm test` (Node 20 o posterior). Sin dependencias.

- Códigos EE01, EV01, ED01, EW04, EJ10 y EH02.
- Siete sugerencias inmediatas al escribir E.
- Búsqueda sin acentos ni distinción de mayúsculas.
- Datos confirmados y ubicaciones pendientes sin edificio inventado.
- Conectividad de todos los destinos desde los cuatro accesos.
- Segmentos de caminos fuera de edificios, canchas y estacionamientos.
- Cruces del canal solamente en los pasos explícitos del modelo.

El modelo del campus es aproximado. Los pasos del canal están representados como puentes provisionales y requieren validación en campo.

## Revisión visual pendiente

La infraestructura de vista previa del entorno devolvió `relay could not open browser port 4173: timed out waiting for relay readiness`. No se han verificado visualmente los tamaños siguientes ni se han generado capturas:

- 1920 × 1080.
- 1366 × 768.
- 768 × 1024.
- 390 × 844.

Al abrir el proyecto en un navegador, verificar en cada tamaño:

1. Buscar cada código anterior y comprobar el centrado y la tarjeta.
2. Buscar E, navegar con flechas y elegir con Enter.
3. Seleccionar edificios con clic, toque y teclado; cerrar la tarjeta.
4. Probar rueda, arrastre, botones de zoom y restablecer.
5. En dispositivo táctil, probar arrastre y pinza con dos dedos.
6. Revisar títulos completos, desplazamiento de tarjetas y ausencia de desbordamiento horizontal.
7. Obtener rutas desde los cuatro accesos y comprobar inicio, destino, tramos y borrado.
8. Confirmar persistencia de favoritos, historial y tema tras recargar.
9. Confirmar que árboles y vegetación no cubran superficies transitables o edificios.
10. Validar los andadores, las entradas de edificios y los puentes en campo antes de uso como guía oficial.
