# Backend de eventos del campus

Este directorio contiene el backend de la galería compartida de fotos y videos y de las transmisiones de eventos. El proyecto autorizado de Supabase ya tiene instalados el esquema, las políticas, el bucket privado y la función `campus-live`. El registro de despliegue y sus comprobaciones están en [deployment.json](deployment.json). La emisión pública requiere además los secretos del propietario y una prueba completa en producción.

La página continúa siendo estática y conserva su URL actual de GitHub Pages. Supabase aporta Auth, PostgreSQL y Storage. Se usa el proyecto que creó el propietario y una cuenta Auth verificada que este autorizó expresamente. Las contraseñas y los secretos privados permanecen fuera del repositorio. Los scripts no contratan planes ni convierten registros nuevos en administradores.

## Preparar el proyecto conectado

1. Conectar el proyecto de Supabase autorizado para esta aplicación e identificar su región y límites de almacenamiento. Si crear recursos supone cargos, obtener autorización para ese costo; este esquema no contrata ningún plan.
2. Abrir su SQL Editor con el rol propietario `postgres` y ejecutar `backend/events.sql` completo. La transacción crea las tablas, funciones, políticas y el bucket privado `campus-events`. Puede ejecutarse otra vez sin eliminar eventos, archivos ni administradores. No es una reparación automática de un esquema antiguo incompatible: revisar migraciones si estas tablas ya existían con otras columnas.
3. Crear o invitar la cuenta del propietario desde **Authentication → Users** mediante el flujo seguro del proyecto. El propietario debe establecer su contraseña por el enlace seguro de Auth, nunca en un archivo o mensaje del repositorio. Confirmar correo o teléfono. No hace falta habilitar el registro público para administrar la galería.
4. Copiar el UUID de esa cuenta ya existente y verificada, y añadirlo explícitamente a `public.event_admins` con el bloque siguiente. La tabla queda vacía inicialmente; registrarse o tener sesión de Auth **no otorga** permisos administrativos.
5. Configurar el cliente del sitio con la URL del proyecto y su clave **publishable/anon**. Esa clave está diseñada para el navegador y su acceso depende de RLS. **No colocar una clave `service_role`, una clave secreta del proyecto ni credenciales de la base de datos en HTML, JavaScript, GitHub, localStorage o la configuración pública del sitio.**
6. Probar los roles de lectura y escritura antes de habilitar cargas para usuarios reales.

Ejecutar solo por el propietario en SQL Editor, reemplazando el UUID centinela por el UUID real verificado:

```sql
do $bootstrap$
declare
  owner_id uuid := '00000000-0000-0000-0000-000000000000';
begin
  if owner_id = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Reemplaza el UUID por el de una cuenta Auth existente y verificada';
  end if;
  if not exists (
    select 1 from auth.users
    where id = owner_id
      and (email_confirmed_at is not null or phone_confirmed_at is not null)
  ) then
    raise exception 'La cuenta no existe o todavía no confirmó correo/teléfono';
  end if;
  insert into public.event_admins (user_id)
  values (owner_id)
  on conflict (user_id) do nothing;
end;
$bootstrap$;
```

Para retirar permisos, el propietario elimina ese UUID de `public.event_admins`. La comprobación de permisos se consulta en cada operación; una sesión previamente iniciada no conserva privilegios administrativos tras retirar su membresía. Las cuentas de visitantes no necesitan pertenecer a esta tabla.

## Contrato de datos

`public.campus_events` contiene:

- `id`: UUID generado por el servidor.
- `title`: texto no vacío, máximo 120 caracteres.
- `description`: texto, máximo 4.000 caracteres; por defecto vacío.
- `location`: texto, máximo 160 caracteres; por defecto vacío.
- `starts_at`: `timestamptz` opcional. Enviar ISO 8601 con desplazamiento o UTC; presentar la hora en `America/Mazatlan` en la interfaz.
- `status`: `draft` o `published`; comienza en borrador.
- `live_state`: `off`, `scheduled`, `live` o `ended`.
- `native_live_enabled`: permite preparar un directo propio para ese evento. `native_stream_id`, `native_last_seen_at` y `live_state` quedan controlados por la función de servidor.
- `youtube_video_id`: columna de compatibilidad con la versión anterior; debe ser nula para los directos nativos. La interfaz no solicita enlaces ni muestra reproductores externos.
- `created_by`: UUID del usuario Auth creador, asignado mediante `auth.uid()` y comprobado al insertar.
- `created_at`, `updated_at`: fechas del servidor. El trigger conserva identidad, fecha de creación y creador al editar, y actualiza `updated_at`.

`public.event_media` contiene `id`, `event_id`, `kind` (`photo`/`video`), `storage_path`, `mime_type`, `original_name` y `created_at`. `event_id` referencia al evento y elimina la fila de metadatos en cascada cuando desaparece el evento. El nombre original se limita a 255 caracteres; no se utiliza como ruta pública ni como nombre de almacenamiento.

Formato obligatorio del objeto:

```text
<UUID-del-evento>/<UUID-aleatorio-del-archivo>.<extensión>
```

No usar nombre de usuario, correo o nombre original como prefijo. El UUID padre debe existir antes de subir. Cada archivo utiliza un UUID nuevo; `storage_path` es único. Extensiones y MIME deben coincidir:

| Tipo | MIME | Extensión |
| --- | --- | --- |
| Foto | `image/jpeg` | `.jpg`, `.jpeg` |
| Foto | `image/png` | `.png` |
| Foto | `image/webp` | `.webp` |
| Foto | `image/gif` | `.gif` |
| Video | `video/mp4` | `.mp4` |
| Video | `video/webm` | `.webm` |
| Video | `video/quicktime` | `.mov` |

El bucket impone **45 MiB** por objeto (`47.185.920` bytes) y la lista de MIME anterior. Si la interfaz limita fotos a 10 MiB, ese es un límite adicional del cliente; el límite de Storage para este bucket sigue siendo 45 MiB. La aceptación de un MIME no garantiza que un códec de video sea reproducible en todos los navegadores. MP4 con códecs web habituales es la opción más interoperable; no hay transcodificación automática en este SQL.

## Permisos y privacidad

- Visitantes anónimos y usuarios con sesión sin membresía administrativa solo leen eventos `published` y sus filas de medios. No pueden consultar borradores ni escribir tablas u objetos.
- Solo una cuenta Auth confirmada cuyo UUID figure en `event_admins` puede crear, editar, publicar o borrar eventos y medios, y leer borradores. `is_event_admin()` comprueba la identidad actual, sin aceptar un UUID suministrado por el cliente.
- El cliente solo puede leer su propia fila en `event_admins`. No tiene permisos para añadir administradores, aunque sea un administrador de eventos. La membresía la gestiona exclusivamente el propietario mediante SQL o un proceso de servidor autorizado.
- `is_event_admin()` usa `SECURITY DEFINER`, propietario `postgres`, búsqueda fija en `pg_catalog` y referencias de esquema explícitas. Únicamente devuelve un booleano sobre el usuario actual; no expone usuarios de Auth ni la lista de administradores.
- Las tablas tienen RLS y privilegios explícitos. Las políticas restrictivas acompañan las permisivas para impedir que una política permisiva amplia preexistente abra estos datos por combinación OR.
- El bucket es **privado**. Las rutas `/object/public/...` no se usan para entregar medios. El cliente obtiene URL firmada para un objeto publicado mediante la API de Storage. Un administrador puede firmar también objetos de borradores.
- La lectura de Storage exige una coincidencia exacta entre el nombre del objeto y `event_media.storage_path`, con un evento padre publicado. Conocer el UUID o la ruta de un borrador no basta para firmar su archivo.
- INSERT/UPDATE en Storage requieren administrador, ruta canónica y evento padre existente. DELETE permite que un administrador elimine también objetos huérfanos del mismo bucket para reparar cargas interrumpidas; esta excepción no concede lecturas o cargas a visitantes.
- Las políticas de protección de Storage solo condicionan el bucket `campus-events`; no otorgan derechos adicionales ni reemplazan políticas de otros buckets.

La URL firmada es un acceso temporal que se puede compartir mientras siga vigente. Cambiar un evento a borrador impide generar nuevas URLs públicas, pero **no revoca las URLs ya emitidas antes de su vencimiento**. El cliente puede usar expiración de una hora; reducirla si se requiere una retirada más rápida. Para retirar un archivo, borrarlo mediante Storage API y considerar el comportamiento de caché del proyecto; no prometer revocación instantánea solo con cambiar `status`.

## Cargas, borrado y limpieza

Una carga consta de dos operaciones que no son atómicas entre PostgreSQL y Storage:

1. Crear el evento en `draft` y obtener su UUID.
2. Subir el objeto al bucket privado con un UUID de archivo nuevo y MIME permitido.
3. Insertar la fila `event_media` con la ruta exacta, el tipo y el MIME.
4. Publicar el evento mediante una acción explícita del administrador cuando el contenido esté revisado.

Si falla el paso 3, eliminar el objeto recién subido mediante Storage API. Si esa limpieza también falla, conservar el error y permitir al administrador reintentar; el objeto huérfano no resulta visible al público porque todavía no existe una fila pública que lo vincule.

Para eliminar un evento con un directo activo, finalizar primero la sesión mediante la función de directo. Después cambiar únicamente `status` a `draft`, eliminar sus objetos mediante Storage API y finalmente borrar el evento. Los clientes no deben modificar el estado del directo que controla el servidor. Si falla el borrado de objetos, mantener el borrador y los metadatos para poder reintentar. Borrar solo la fila SQL elimina metadatos por cascada pero **no elimina los archivos**.

Limpiar objetos huérfanos desde un proceso autorizado que compare los nombres de Storage con `event_media.storage_path`. Usar siempre la API de Storage para subir/borrar archivos; no borrar directamente filas de `storage.objects`, pues puede dejar los bytes almacenados fuera de sincronía. No se instala ninguna tarea programada ni servicio de limpieza automático con este esquema.

`created_by` mantiene una referencia a Auth con borrado restringido para conservar la autoría. Retirar permisos administrativos no exige eliminar la cuenta Auth. La eliminación permanente de una cuenta con eventos requiere una decisión y migración del propietario sobre esa autoría; no eludir la restricción borrando datos sin revisión.

## Transmisiones en vivo

Los directos se capturan y se reproducen dentro de la propia página mediante WebRTC y LiveKit. Después del esquema de galería, ejecutar `backend/native-live.sql` y desplegar la función `campus-live` según [NATIVE-LIVE.md](NATIVE-LIVE.md). La función verifica al administrador, limita los permisos de publicación o recepción, asigna una sala por sesión y confirma que existen pistas de cámara y micrófono antes de anunciar la emisión.

Supabase por sí solo y los archivos de GitHub Pages no distribuyen el audio/video. Se requiere un proyecto LiveKit autorizado o un servidor propio con HTTPS/WSS y conectividad RTC. Las claves privadas permanecen en los secretos del backend; los clientes reciben tokens temporales restringidos. La cuenta y los servicios públicos todavía deben activarse: no confundir las pruebas con una emisión disponible en producción.

## Comprobación antes de habilitar el backend

La revisión estática del SQL no equivale a ejecutar estas pruebas en Supabase. Después de aplicar la transacción en el proyecto autorizado, verificar:

| Identidad | Publicados | Borradores | Cargar/editar | Firmar medio publicado | Firmar medio de borrador |
| --- | --- | --- | --- | --- | --- |
| Sin sesión | Sí | No | No | Sí | No |
| Usuario Auth ajeno a `event_admins` | Sí | No | No | Sí | No |
| Usuario listado pero no confirmado | Sí | No | No | Sí | No |
| Administrador listado y confirmado | Sí | Sí | Sí | Sí | Sí |

Probar además rutas malformadas, rutas con otro UUID padre, eventos inexistentes, extensiones/MIME incompatibles, archivos superiores al límite y retirada de membresía con una sesión activa. Los intentos no autorizados deben ser rechazados por el servidor incluso si se evitan los controles de la interfaz.

Auditoría de políticas instalada, usando el propietario:

```sql
select schemaname, tablename, policyname, permissive, roles, cmd
from pg_policies
where (schemaname = 'public' and tablename in
       ('campus_events', 'event_media', 'event_admins'))
   or (schemaname = 'storage' and tablename = 'objects'
       and policyname like 'campus_event_objects_%')
order by schemaname, tablename, policyname;

select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'campus-events';
```

Comprobar también que el proyecto no exponga vistas, funciones adicionales, claves de servidor o accesos alternativos que eludan las políticas. Esta migración no configura límites de facturación, retención, copias de seguridad, moderación de contenido ni una plataforma de retransmisión; esos ajustes pertenecen al proyecto conectado y a las decisiones del propietario.
