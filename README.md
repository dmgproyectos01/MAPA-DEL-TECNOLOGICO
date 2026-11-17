# Mapa interactivo del Tecnológico de Culiacán

Aplicación web estática e interactiva para localizar edificios, salones, servicios y rutas dentro del campus.

## Estado

Repositorio inicializado para la reconstrucción segura del proyecto. El desarrollo se realizará sin Unity, con respaldos frecuentes mediante commits en GitHub.

## Versión con el plano original

La única capa visual del campus es `assets/mapa-campus-base-v2.webp`. Los caminos, edificios, canal, jardines, estacionamientos y deportes son los píxeles del plano original; no se dibujan encima figuras que los sustituyan. El SVG contiene la imagen, zonas transparentes para seleccionar lugares y la ruta activa.

El archivo procede de una [copia del plano en alta resolución](https://github.com/Serpens55/ChatbotPrueba2/blob/94c1ce3c9188efc874408d85c617e26f739b0510/static/img/mapa.png). Se conserva la sección del campus, sus accesos y brújula. Se elimina la leyenda, logotipos y hashtag de la sección derecha. La máscara de recorte conserva el campus completo: la validación cuenta **cero píxeles del campus eliminados**. La codificación WebP es sin pérdida y se comprueba comparando los píxeles visibles después de decodificar. `assets/mapa-campus-base.json` registra fuente, hashes, recorte, máscara y proporción.

### Abrir localmente

Requiere Node.js 20 o posterior. La aplicación no necesita instalar paquetes ni ejecutar un compilador:

```sh
npm run dev
```

Abre `http://localhost:3000`. También funciona con `python3 -m http.server 3000`. Servir mediante HTTP permite leer los módulos JavaScript y JSON; `file://` puede bloquearlos.

### Usar el mapa

- Busca edificios, departamentos, laboratorios, servicios o códigos de salón. `/` enfoca el buscador; flechas y Enter eligen una sugerencia; Escape cierra la ficha.
- Escribir `E` muestra EA01, ED01, EE01, EV01, EW01, EJ01 y EH01. Los códigos sin detalle confirmado siguen localizando el edificio, sin mostrar una ficha de salón no asignado.
- Selecciona un edificio con clic, toque o teclado. Solo aparece un contorno o resaltado transparente sobre su ubicación. Las fichas son flotantes y desplazables; en móvil aparecen abajo.
- Las fichas muestran salones, servicios, pisos y horarios solo cuando tienen información asignada. Se omiten los apartados vacíos o con el valor «Por confirmar», conservando todos los datos existentes.
- UA y UP tienen botones por planta o piso y listas con desplazamiento independiente. Buscar un laboratorio, área, profesor o `UP-15` abre su piso y resalta el espacio encontrado; las búsquedas recientes conservan ese destino. Los salones sin código se muestran únicamente como cantidades confirmadas.
- Explora con rueda, arrastre, pinza táctil o botones de zoom. El botón de mira muestra todo el campus sin deformar su proporción.
- Para retirar un recorrido, pulsa **Quitar ruta** en la parte superior izquierda del mapa o al inicio de las indicaciones. La **×** de la ficha también borra la línea y sus marcadores. En computadora, **Escape** quita la ruta cuando no estás escribiendo en un campo. El botón del mapa sigue disponible aunque selecciones otro edificio y se oculten las indicaciones.
- Los filtros marcan las zonas correspondientes sobre el plano; conservan intacta la imagen. El modo oscuro afecta los controles y las fichas.
- Favoritos, visitas, búsquedas y tema se guardan localmente. Los historiales incluyen controles para limpiarlos.

### Fotos, videos y eventos en vivo

El botón **Eventos** abre la galería sin salir del mapa. Las fotos y videos se agrupan por evento; las transmisiones de YouTube se reproducen dentro del apartado al elegir verlas. El acceso de administrador permite preparar borradores, adjuntar archivos y publicar. Los visitantes solo pueden consultar eventos publicados.

GitHub Pages sirve la interfaz. Para recibir archivos y compartir publicaciones entre dispositivos se requiere activar el servicio Supabase descrito en `backend/README.md`. La configuración pública está en `data/events-config.json`: URL del proyecto, clave pública y nombre del bucket. No se incluyen contraseñas, claves privadas ni claves de servicio en los archivos del sitio. Cuando la configuración está vacía, la galería muestra su estado inicial y explica que la publicación todavía no está habilitada; no simula subidas ni guarda publicaciones públicas únicamente en el teléfono.

Las transmisiones de YouTube se inician desde el canal del organizador. Registrar un enlace o marcar su estado en esta página no inicia una emisión desde la cámara. La interfaz valida los enlaces y carga el reproductor al solicitar verlo.

`npm run test:events` comprueba el flujo de administración y galería con respuestas de un servicio simulado en un contexto aislado de navegador. Esas pruebas no publican contenido real y no acreditan que una cuenta de almacenamiento o un canal estén activos. La comprobación de la página pública también conserva las pruebas del mapa.

### Datos confirmados

W, R, Q, J, H y Ñ conservan los datos confirmados del encargo. V incluye Laboratorio de Mecánica y Laboratorio de Eléctrica y mantiene el Departamento de Metal-Mecánica. Psicología, Dentista, Microbiología e Investigación, Química-Bioquímica y Biotecnología Agrícola siguen sin un edificio asignado cuando no existe confirmación oficial. El consultorio médico está en H. Los servicios de salud muestran lunes a viernes de 7:00 a. m. a 1:00 p. m., zona America/Mazatlan.

### Rutas sobre la imagen

La red se extrae del centro de los píxeles de pasillos claros y de explanadas transitables identificadas en la fuente. Los peldaños, el puente visible y los cruces anotados se registran explícitamente. La máscara binaria `data/navigation-mask.bin` permite comprobar cada segmento, sin añadir diagonales para unir componentes por jardines o edificios.

El destino es el punto del camino más cercano al contorno del edificio. No se afirma conocer una puerta o un salón interior no señalados en la fuente. Donde falta un acceso peatonal conectado verificable, el lugar se puede buscar y seleccionar, pero la ruta aparece como acceso por confirmar. El acceso vehicular por Cómputo tiene esa misma limitación para recorrido peatonal.

La distancia usa una escala provisional de 0.7 metros por unidad del plano. Los cruces viales y pasos ocultos por símbolos que necesiten confirmación se avisan en las rutas que los usan. La guía no acredita accesibilidad física ni cierres actuales.

### Archivos principales

- `index.html`, `css/styles.css`: interfaz estática y estilos responsivos.
- `js/map.js`: imagen original y zonas SVG transparentes.
- `js/app.js`, `js/search.js`: fichas y búsqueda predictiva.
- `js/camera.js`: zoom y gestos registrados al mismo marco de la imagen.
- `js/routes.js`: rutas Dijkstra con cola de prioridad y avisos de cruces anotados.
- `js/preferences.js`: filtros, tema, favoritos e historial.
- `data/locations.json`: datos y contornos de selección alineados a los techos reales.
- `data/routes.json`, `data/navigation-mask.bin`: red y máscara peatonal verificable.
- `assets/mapa-campus-base.json`: procedencia y registro geométrico del recorte.
- `tests/`: pruebas automáticas, validación de navegador y capturas.

### Comprobar y regenerar

```sh
npm test
```

Las pruebas de Node no requieren dependencias. Verifican búsquedas, datos confirmados, proporción, unicidad de la imagen, integridad de la máscara y rutas completas sobre sus píxeles.

Para la comprobación Playwright en un equipo de desarrollo:

```sh
npm install --no-save playwright@1.62.1
npx playwright install chromium
python3 -m pip install Pillow numpy
npm run test:browser
```

`CAMPUS_QA_URL` permite probar la página publicada. Se comprueban computadora y celular, consola, textos, búsquedas, selección, zoom, filtros, tema, favoritos y rutas. Se compara el activo servido con su SHA y los píxeles del original; la diferencia introducida al reducir la imagen para pantalla se informa aparte. Las capturas e informe quedan en `tests/screenshots/` y `work/qa-raster-report.json`.

La preparación del recorte y regeneración de la red son herramientas de desarrollo, no dependencias de ejecución de la web:

```sh
python3 -m pip install Pillow numpy scipy
python3 tools/prepare-campus-image.py ruta/al/original.png
python3 tools/build-routes.py
```

La primera herramienta exige la resolución registrada de 4096 × 2212 para evitar aplicar un recorte a otra imagen. La segunda usa el recorte local por defecto y verifica la máscara antes de guardar datos. Después de regenerar, actualizar el registro `base` de `data/map-layout.json` y ejecutar las pruebas.

### GitHub Pages

La dirección se conserva:

https://dmgproyectos01.github.io/MAPA-DEL-TECNOLOGICO/

`.github/workflows/pages.yml` ejecuta las pruebas, publica únicamente los archivos estáticos y después abre la dirección publicada con Playwright. El trabajo `verify-published` guarda capturas y comparación de píxeles como artefacto `capturas-pagina-publicada`. Un cambio queda comprobado cuando los trabajos `deploy` y `verify-published` terminan correctamente para ese commit.

El nombre versionado de la imagen y las versiones de módulos/JSON evitan reutilizar la ilustración anterior por caché. No se cambia el público ni la dirección del sitio mediante este proyecto.
