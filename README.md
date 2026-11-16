# Mapa interactivo del Tecnológico de Culiacán

Aplicación web estática e interactiva para localizar edificios, salones, servicios y rutas dentro del campus.

## Estado

Repositorio inicializado para la reconstrucción segura del proyecto. El desarrollo se realizará sin Unity, con respaldos frecuentes mediante commits en GitHub.

## Implementación actual

Mapa SVG interactivo del Instituto Tecnológico de Culiacán, reconstruido desde cero a partir de la distribución de la imagen de referencia. HTML5, CSS y JavaScript nativos, sin dependencias de ejecución, sin Unity, sin Blender y sin backend obligatorio.

### Abrir localmente

Con Node.js 20 o posterior:

```sh
npm run dev
```

Abre `http://localhost:3000`. Como alternativa, ejecuta `python3 -m http.server 3000`. No hace falta `npm install`. Servir mediante HTTP es necesario para los módulos JavaScript y la lectura de JSON; abrir `index.html` directamente con `file://` puede estar bloqueado por el navegador.

### Uso

- Busca edificios, departamentos, servicios o códigos de salón. `/` enfoca el buscador. Flechas y Enter seleccionan sugerencias; Escape cierra la información.
- Escribir `E` muestra EA01, ED01, EE01, EV01, EW01, EJ01 y EH01. Los códigos de salones sin detalle confirmado localizan su edificio y avisan que la información está por confirmar.
- Selecciona un edificio con clic, toque o teclado. Su ficha contiene salones, servicios, pisos y horarios disponibles.
- Usa rueda, arrastre, botones +/− y gestos con dos dedos para explorar. El botón de mira restablece la vista de todo el campus.
- Pulsa **Cómo llegar**, elige uno de los cuatro accesos y un destino. Se muestran una ruta animada, distancia aproximada, tiempo estimado e instrucciones. Usa **Borrar ruta** para retirarla.
- Los filtros permiten localizar aulas, laboratorios, administración, deportes, estacionamientos y salud.
- Guarda favoritos desde cada ficha. Favoritos, visitas, búsquedas y modo de color se almacenan únicamente en el navegador mediante localStorage. El historial de visitas y el de búsquedas tienen controles independientes para limpiarlos.
- La leyenda se despliega desde la barra inferior. En móvil las fichas aparecen abajo y permiten desplazamiento interno.

### Datos y límites

`data/locations.json` contiene lugares, geometría y datos; `data/routes.json` contiene nodos, conexiones, accesos y escala aproximada. W, R, Q, J, H y Ñ incorporan los datos confirmados del encargo. Las letras y posiciones restantes siguen el mapa de referencia; los detalles desconocidos se indican como **por confirmar**.

Psicología, Dentista, Microbiología e Investigación, Química-Bioquímica y Biotecnología Agrícola no tienen un edificio asignado mientras no exista confirmación oficial. El consultorio médico está en H. Los servicios de salud muestran lunes a viernes, de 7:00 a. m. a 1:00 p. m., zona horaria America/Mazatlan.

Las rutas son orientativas: la escala usa una conversión provisional de 0.7 metros por unidad del dibujo. Los andadores, puertas y puentes sobre el canal requieren validación en campo. Los cruces provisionales están señalados en el mapa y en la tarjeta de rutas. No se han confirmado accesibilidad física ni cierres temporales.

### Estructura

- `index.html`: entrada de la aplicación.
- `css/styles.css`: estilos, temas y adaptación de pantalla.
- `js/app.js`: interfaz y fichas.
- `js/map.js`: representación SVG.
- `js/camera.js`: cámara y gestos.
- `js/search.js`: búsqueda y almacenamiento local.
- `js/routes.js`: Dijkstra, trazado e instrucciones.
- `js/preferences.js`: filtros, favoritos, visitas y tema.
- `data/`: ubicaciones y red peatonal.
- `tools/build-routes.py`: regeneración de la red y conexiones de puertas a partir de los datos. Ejecutar desde la raíz del repositorio; revisar los cruces provisionales antes de modificar su geometría.
- `tests/`: pruebas y lista de verificación visual.

### Pruebas

```sh
npm test
```

14 pruebas automáticas cubren búsqueda, datos pendientes, conectividad y geometría. Ver `tests/VALIDACION.md` para límites y verificaciones visuales pendientes. No se afirma que las pruebas automáticas sustituyan una revisión del navegador o una validación del plano en campo.

### GitHub Pages

El workflow `.github/workflows/pages.yml` valida la aplicación y prepara exclusivamente los archivos estáticos. Al subir a `main`, intenta habilitar Pages y publicar con GitHub Actions, conservando la visibilidad del repositorio.

Si la primera ejecución falla al habilitar Pages, un administrador debe abrir **Settings → Pages → Build and deployment → Source → GitHub Actions** y volver a ejecutar **Validar y publicar en GitHub Pages** desde Actions. El token de Actions puede no tener permiso para habilitar Pages automáticamente. Los repositorios privados necesitan un plan que admita GitHub Pages; no se cambia la privacidad automáticamente.

La URL esperada, únicamente después de un despliegue satisfactorio, es `https://dmgproyectos01.github.io/MAPA-DEL-TECNOLOGICO/`. El estado de publicación se confirma en el job `deploy`, no por la existencia de esta URL en la documentación.
