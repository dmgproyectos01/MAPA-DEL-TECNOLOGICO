# Plano original recortado

`mapa-campus-base-v2.webp` es la única base visual de la aplicación. No hay edificios, caminos, árboles ni canchas dibujados encima para sustituir el plano. Los contornos de selección y la ruta son capas transparentes independientes.

Fuente PNG:
https://github.com/Serpens55/ChatbotPrueba2/blob/94c1ce3c9188efc874408d85c617e26f739b0510/static/img/mapa.png

SHA-256 de la fuente: `a6f63493b969501b67a5846be4baa75dde70e80201cc06ff488e7651a56d5e36`.

`mapa-campus-base.json` registra el recorte, eliminación de la leyenda por máscara, resolución y SHA del WebP. La imagen no se ha remuestreado ni regenerado. La decodificación del WebP conserva exactamente los píxeles visibles y la preparación verifica que no se eliminen píxeles del campus conectado.

Los nombres versionados y las versiones en los módulos evitan reutilizar la ilustración anterior por caché. La sección derecha de la lámina original no forma parte de la imagen visible final.
