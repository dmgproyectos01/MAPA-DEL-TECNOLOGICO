# Validación de la versión con imagen original

La imagen base es un recorte del PNG original de 4096 × 2212, codificado como WebP sin pérdida y registrado mediante `assets/mapa-campus-base.json`. Las figuras del dibujo SVG anterior ya no se representan. La imagen conserva proporción, accesos y brújula y elimina la leyenda y marcas de la sección derecha.

## Pruebas automáticas

`npm test` ejecuta 92 comprobaciones sin dependencias adicionales:

- EE01, EV01, ED01, EW04, EJ10 y EH02; siete sugerencias con E; acentos y mayúsculas.
- Datos confirmados y ubicaciones pendientes sin edificio inventado; laboratorios de Mecánica y Eléctrica en V.
- SHA, proporción y registro de la base; una sola imagen y ausencia del dibujo vectorial anterior.
- SHA y lectura de máscara peatonal; todos los nodos y segmentos dentro de las superficies autorizadas.
- Conectividad de los destinos confirmados desde los tres accesos peatonales.
- Ausencia de conexiones inventadas a accesos pendientes y ausencia de cruces de edificios o deportes.
- Identidad de UA/UP, distribución confirmada por piso, cantidades sin códigos inventados, cada laboratorio y profesor, UP-15, selección con piso e historial de búsquedas.
- Validación de enlaces y archivos de eventos, Auth y permisos simulados, renovación de sesión, uploads y limpieza de cargas interrumpidas.

La extracción contiene 1132 nodos y 1183 aristas. Se comprobó adicionalmente con Node a densidades de 2, 2.5, 4 y 8 muestras por píxel y redondeo bancario: 310776 muestras y cero fuera de la máscara. Los cruces por esquinas exigen cobertura de todos los píxeles adyacentes; las reparaciones siguen cuatro vecinos dentro de la máscara, sin ampliarla.

## Playwright

`npm run test:browser` abre la aplicación real en 1366 × 768 y 390 × 844. Las 52 comprobaciones cubren consola, red, desbordamiento, proporción, transparencia de zonas no seleccionadas, búsquedas y teclado, selección y cierre, zoom, tema, favoritos e historial, filtros, eliminación de rutas y apertura/cierre del apartado Eventos. También se comprueba que el destino no quede detrás de la tarjeta inferior en móvil.

`npm run test:events` añade 9 escenarios de interfaz en computadora y celulares de 390 y 320 píxeles, usando un backend Supabase **simulado e interceptado**. Verifica galería, archivos de imagen/video reproducibles, acceso de administrador, borradores, subidas múltiples, publicación fallida y reintento, opciones de directo nativo, tema y foco. Estas pruebas no escriben en producción ni sustituyen la activación y validación del proyecto real. El informe `work/qa-events-report.json` distingue expresamente esa condición.

`npm run test:live` conecta la interfaz de emisor y espectador mediante el SDK local y un servidor SFU LiveKit real, con imagen Docker oficial fijada por digest. Auth y las respuestas de base de datos se aíslan con fixtures, sin cuentas ni cámaras personales. Se comprueban video decodificado, pista de audio, permisos de solo recepción, confirmación de publicación, finalización y captura detenida. El job obligatorio `native-live-check` ejecuta esa prueba en un navegador estándar de GitHub Actions antes del despliegue.

En el Chromium administrado de este entorno, la política `WebRtcIPHandling=disable_non_proxied_udp` impide el transporte ICE local del servidor de prueba. Esa protección no se ha modificado: el informe local registra el bloqueo y no lo contabiliza como una transmisión aprobada. La denegación de permisos de captura sí se comprobó en ese navegador. El resultado de transporte completo debe consultarse en el informe del job de CI, separado de la activación de los servicios públicos.

La función de servidor tiene además pruebas de HMAC, Auth, permisos y caducidad de tokens, CORS, prueba de publicación real, cierre de sala y revocación Cloud. El esquema se ejecutó en PostgreSQL 17.12 de prueba con roles Auth/Storage sintéticos: campos protegidos, RPC privados, concurrencia de reservas y repetición de migraciones aprobados. Esto no equivale a desplegar Supabase o LiveKit Cloud.

La configuración de eventos se entrega vacía hasta conectar el proyecto autorizado. La página publicada muestra la galería inicial y avisa que la publicación todavía no está habilitada. Los archivos `events-*-published-gallery.png` son capturas del estado real de esa página; `events-*-public.png` y `events-*-admin.png` proceden de los escenarios con datos de prueba.

UA y UP se seleccionan con clic real sobre sus zonas del mapa. Se verifican todos sus botones de piso, navegación por teclado, listas completas, desplazamiento vertical con los controles accesibles, búsquedas de UP-15, Mecatrónica, un laboratorio de UP, Incubadora de Software, Saida Lizárraga y DEPI. La búsqueda reciente de la profesora restaura el tercer piso. Los filtros de salones, laboratorios y administración incluyen los espacios confirmados de ambas unidades.

El artefacto `capturas-pagina-publicada` incluye `raster-desktop-ua.png`, `raster-desktop-up.png`, `raster-mobile-ua.png` y `raster-mobile-up.png`, generados al comprobar la página publicada.

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
