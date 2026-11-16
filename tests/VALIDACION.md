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

## Revisión visual de la interfaz institucional

Se verificó en Chromium la nueva interfaz en marcos de prueba de 1920 × 1080, 1366 × 768, 768 × 1024 y 390 × 844. Capturas: `tests/screenshots/`.

- Colores institucionales en encabezado, botones, filtros y tarjetas.
- Encabezado y buscador sin desbordamientos visibles.
- Filtros con desplazamiento horizontal en pantallas estrechas.
- Búsqueda de EH02, apertura y cierre de la ficha.
- Título de la ficha legible, contenido con desplazamiento interno.
- Centrado del edificio por encima de la tarjeta inferior en 390 × 844.
- Temas claro y oscuro; el mapa conserva su paleta.

La vista previa reenviada sigue sin conexión, pero se pudo verificar la aplicación local en Chromium. No se probó pinza en dispositivo táctil físico. La fidelidad del mapa a la referencia permanece pendiente del archivo fuente original.

## Verificaciones adicionales y en campo

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
