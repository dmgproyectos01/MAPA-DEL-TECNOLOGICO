# Validación de la versión con imagen original

La imagen base es un recorte del PNG original de 4096 × 2212, codificado como WebP sin pérdida y registrado mediante `assets/mapa-campus-base.json`. Las figuras del dibujo SVG anterior ya no se representan. La imagen conserva proporción, accesos y brújula y elimina la leyenda y marcas de la sección derecha.

## Pruebas automáticas

`npm test` ejecuta 21 comprobaciones sin dependencias adicionales:

- EE01, EV01, ED01, EW04, EJ10 y EH02; siete sugerencias con E; acentos y mayúsculas.
- Datos confirmados y ubicaciones pendientes sin edificio inventado; laboratorios de Mecánica y Eléctrica en V.
- SHA, proporción y registro de la base; una sola imagen y ausencia del dibujo vectorial anterior.
- SHA y lectura de máscara peatonal; todos los nodos y segmentos dentro de las superficies autorizadas.
- Conectividad de los destinos confirmados desde los tres accesos peatonales.
- Ausencia de conexiones inventadas a accesos pendientes y ausencia de cruces de edificios o deportes.

La extracción contiene 1132 nodos y 1183 aristas. Se comprobó adicionalmente con Node a densidades de 2, 2.5, 4 y 8 muestras por píxel y redondeo bancario: 310776 muestras y cero fuera de la máscara. Los cruces por esquinas exigen cobertura de todos los píxeles adyacentes; las reparaciones siguen cuatro vecinos dentro de la máscara, sin ampliarla.

## Playwright

`npm run test:browser` abre la aplicación real en 1366 × 768 y 390 × 844. Las 32 comprobaciones cubren consola, red, desbordamiento, proporción, transparencia de zonas no seleccionadas, búsquedas y teclado, selección y cierre, zoom, tema, favoritos e historial, filtro de laboratorios y ruta con borrado. También se comprueba que el destino no quede detrás de la tarjeta inferior en móvil.

La comparación independiente reconstruye el recorte desde la fuente PNG, aplica la misma máscara de eliminación de leyenda y compara los píxeles visibles con el archivo WebP: **cero diferencias**, **cero píxeles del campus eliminados**. La diferencia de remuestreo del navegador al reducir la imagen para pantalla se registra por separado y no se confunde con cambios en el plano.

Capturas y comparaciones actuales:

- `screenshots/raster-desktop.png`
- `screenshots/raster-mobile.png`
- `screenshots/raster-desktop-route.png`
- `screenshots/raster-mobile-route.png`
- `screenshots/raster-comparison-desktop.png`
- `screenshots/raster-comparison-mobile.png`

Las capturas anteriores al cambio de imagen se conservan como historial y no describen la versión actual.

## Publicación

GitHub Actions ejecuta las pruebas, publica en la misma URL y vuelve a ejecutar Playwright contra esa página publicada. Se exige que el SHA del archivo de imagen efectivamente servido coincida con el del commit. El artefacto `capturas-pagina-publicada` contiene capturas e informe de la página publicada. Revisar `verify-published` para el resultado del commit concreto.

## Límites documentados

Hay 34 destinos con conexión peatonal verificable en la fuente. Permanecen pendientes U, X, Y, UP/7, gimnasio-auditorio, fútbol, béisbol, EST3 y la conexión peatonal desde el acceso vehicular de Cómputo. Todos siguen visibles y seleccionables; no se rellenan esos huecos con rutas sobre jardines.

El cruce corto de avenida frente al puente visible de UA y el paso tapado por el símbolo Z se registran como provisionales y se avisan solo en rutas que los usan. La distancia es aproximada y el plano no acredita puertas interiores, accesibilidad física ni cambios recientes en campo.
