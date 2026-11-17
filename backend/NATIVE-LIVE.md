# Transmisión nativa de cámara y micrófono

La emisión y la reproducción permanecen dentro de la página del campus. El navegador del administrador publica cámara y micrófono mediante WebRTC a un servidor **LiveKit SFU**; los visitantes reciben esas pistas en el reproductor de la página. No se usa un reproductor de YouTube ni se necesita pegar una URL de otro video.

**Estos archivos no activan un servicio de nube por sí solos.** Hace falta conectar el proyecto autorizado de Supabase, disponer del servidor/proyecto LiveKit del propietario y desplegar la función con sus secretos. Mientras eso no esté hecho, la interfaz debe indicar que la transmisión no está configurada. No se han contratado planes, creado recursos gestionados ni introducido credenciales de producción mediante este código.

## Instalar y activar

1. Usar el proyecto Supabase autorizado y el administrador Auth verificado que figuren en `public.event_admins`, según `backend/README.md`. No convertir cada registro nuevo en administrador.
2. Para una instalación nueva ejecutar **primero** `backend/events.sql` y **después** `backend/native-live.sql` en SQL Editor como propietario `postgres`. En una instalación que ya tenga la galería, ejecutar la migración `native-live.sql`. Es obligatoria antes de exponer controles nativos: instala los bloqueos y RPC privados. Las transacciones se pueden repetir sin vaciar galerías, sesiones o administradores.
3. Usar un servidor LiveKit autorizado por el propietario. LiveKit Cloud requiere su cuenta/proyecto y aceptar sus condiciones en su flujo normal; no crear recursos de pago ni cambiar planes sin autorización. Un servidor propio necesita HTTPS/WSS, WebRTC/TURN y operación real; un archivo estático no sustituye ese servidor.
4. Añadir los secretos de LiveKit en **Supabase → Edge Functions → Secrets**, mediante la interfaz segura del proyecto. No poner sus valores en archivos del repositorio, argumentos de comandos compartidos, HTML, configuración pública o capturas.
5. Desplegar la función `campus-live`. `supabase/config.toml` contiene `verify_jwt = false` únicamente porque la operación de espectador admite visitantes anónimos; todas las operaciones del emisor verifican su token mediante Auth y la lista de administradores dentro de la función.
6. Mantener la URL actual de GitHub Pages. El endpoint admite exclusivamente el origen de producción `https://dmgproyectos01.github.io`. CORS no sustituye la autenticación: un cliente que falsifique ese encabezado sigue necesitando una cuenta verificada y autorizada para emitir.
7. Configurar el cliente con la URL pública de Supabase/función y la clave publishable/anon. Activar las opciones de emisión solo cuando la conexión, migración y pruebas del proyecto real estén completas.

Variables del servidor:

| Variable | Uso |
| --- | --- |
| `LIVEKIT_URL` | URL `wss://…` del SFU de producción, sin credenciales, query ni fragmento. |
| `LIVEKIT_API_KEY` | Identificador de la clave de servidor de LiveKit. |
| `LIVEKIT_API_SECRET` | Secreto de firma; solo servidor. |
| `SUPABASE_URL` | URL HTTPS del proyecto, normalmente disponible en Edge Functions. |
| `SUPABASE_ANON_KEY` | Clave pública utilizada para consultar Auth con el token del usuario. |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave privada automática del proyecto para los RPC internos; nunca enviarla al navegador. |
| `LIVEKIT_CLOUD_REVOCATION` | Solo para un dominio personalizado de LiveKit Cloud: `true` activa revocación Cloud. Se activa automáticamente para `*.livekit.cloud`. No habilitarla para servidores propios sin soporte. |

Las únicas excepciones de desarrollo son `LIVEKIT_ALLOW_LOCALHOST=true`, SFU en `ws://localhost`/`127.0.0.1` y `TEST_ORIGIN` local explícito. Esa excepción no permite una dirección WebSocket insegura externa ni cambia el origen de producción. No utilizarla en producción.

## Estado verdadero de una emisión

`native_live_enabled` habilita la posibilidad de emitir; marcarlo no significa que haya una señal. `native_stream_id` y `native_last_seen_at` los administra el servidor. `live_state` tiene los estados `off`, `scheduled`, `live` y `ended`.

El flujo es:

1. `start`: verifica al administrador, bloquea la fila del evento y reserva una sesión con un UUID nuevo. Solo se admite un emisor activo por evento. Se crea una sala con nombre derivado en el servidor y el estado queda `scheduled`.
2. El navegador solicita permiso y publica sus pistas de cámara y micrófono. Una vista previa local no declara el evento en vivo.
3. `confirm`: el servidor consulta `ListParticipants` en el SFU y exige la identidad del propietario activo y ambas pistas publicadas en la misma respuesta antes de pasar a `live`. Como la publicación puede aparecer después de su acuse inicial, consulta hasta seis veces, con pausas de 300 ms y un presupuesto total de consulta de 3 segundos. Si faltan pistas, mantiene la reserva sin declarar LIVE; los errores del proveedor se devuelven de inmediato. Este sondeo solo se aplica a la confirmación: `heartbeat` y `view` comprueban una única respuesta actual.
4. `heartbeat`: vuelve a comprobar la presencia y las pistas reales, y renueva la marca de tiempo del servidor. El cliente debe enviarlo aproximadamente cada 20 segundos mientras emite.
5. `view`: solo concede una credencial de espectador si el evento está publicado, está habilitado para emisión nativa, existe una sesión `live` con actividad menor a 75 segundos y el SFU sigue mostrando al emisor y sus pistas.
6. `stop`: verifica propietario, cierra la sala real y después marca la sesión como terminada. Si el proveedor falla, se devuelve un error recuperable y no se afirma falsamente que todo terminó. La repetición del cierre admite una sala ya eliminada.

Una reserva expira si no se confirma o mantiene durante 75 segundos. La siguiente reserva retira la sesión vieja y cierra su sala antes de entregar una credencial nueva. El nombre incluye un UUID de sesión nuevo; nunca se reutiliza la sala de una emisión anterior. Los asistentes de una sesión vieja no quedan conectados automáticamente a la nueva.

En LiveKit Cloud el cierre también revoca la identidad del emisor y las de los participantes presentes con un corte temporal explícito. Aunque falle esa revocación, se intenta cerrar el transporte; el resultado sigue siendo un error para que se reintente la limpieza pendiente.

Un corte de red puede tardar hasta la ventana de actividad de 75 segundos en reflejarse en la lista de eventos. La solicitud para ver verifica además el estado actual del SFU. Las pistas silenciadas siguen siendo publicaciones; la función no certifica el contenido de los fotogramas ni que se escuche una voz en cada instante.

## Contrato del endpoint

`POST <SUPABASE_URL>/functions/v1/campus-live`, JSON de hasta 4.096 bytes:

```json
{"action":"start","eventId":"UUID-del-evento"}
```

Las acciones admitidas son `start`, `confirm`, `heartbeat`, `stop` y `view`. Las dos de confirmación requieren `streamId`; `stop` puede resolver la sesión actual si se omite. El emisor envía su `Authorization: Bearer <access_token-de-Auth>`. Un visitante utiliza `view` sin iniciar sesión.

- `start` y `view`: `{ "url", "token", "streamId", "roomName" }`.
- `confirm` y `heartbeat`: `{ "live": true, "streamId" }`.
- `stop`: `{ "ended": true, "streamId" }`.
- Error: `{ "error": { "code", "message" } }` con HTTP 400/401/403/404/409/413/415/502/503 según el caso.

La función rechaza nombres de sala, identidades, permisos o campos adicionales enviados por el cliente. Los UUID deben tener formato canónico en minúsculas. Sus respuestas usan `Cache-Control: no-store`.

## Separación de permisos

El handler puro de `supabase/functions/_shared/campus-live.js` firma JWT HS256 con WebCrypto y consulta la API HTTP Twirp del servidor; no necesita un SDK de servidor. `campus-live/index.ts` lo expone con `Deno.serve`.

- Emisor: JWT de entrada de 120 segundos, identidad derivada del usuario/sesión, sala fija, cámara y micrófono únicamente, sin suscripción y sin publicación de datos.
- Espectador: identidad aleatoria generada por el servidor, sala fija, solo suscripción, sin publicación de medios o datos.
- Servicio: JWT de 60 segundos con la facultad exacta necesaria para crear/cerrar la sala o inspeccionar/revocar participantes. Nunca se devuelve al navegador.

Las capacidades se basan en [Access tokens & grants](https://docs.livekit.io/frontends/reference/tokens-grants/) y las solicitudes en [Room service API](https://docs.livekit.io/reference/other/roomservice-api/).

`public.campus_live_sessions` no tiene permisos de lectura o escritura para visitantes, administradores de la galería ni acceso REST directo con `service_role`. Los RPC de sesiones sí son exclusivos de `service_role`, utilizan `SECURITY DEFINER`, propietario `postgres` y `search_path = pg_catalog`. Esas funciones no deben concederse a `anon` o `authenticated`.

El trigger de eventos diferencia el rol de servicio del usuario Auth de la solicitud. Un administrador normal no puede falsificar `live_state`, `native_stream_id` ni `native_last_seen_at` mediante un PATCH, ni ocultar, deshabilitar o borrar un evento con sesión activa sin detenerla antes. Puede seguir editando título, descripción, lugar y fecha. La columna `youtube_video_id` se conserva solo por compatibilidad de datos anteriores y debe ser nula cuando la emisión nativa esté habilitada; no interviene en el transporte.

## Límites y operación

La expiración del JWT se aplica al acceso inicial; LiveKit renueva credenciales de participantes conectados. Por eso el cierre real de la sala es necesario. Cloud dispone de revocación; un SFU propio no ofrece la misma garantía de invalidación de un token ya emitido. No presentar el TTL de 120 segundos como una desconexión automática ni como revocación instantánea de todos los tokens en un servidor propio. Véase [ciclo y revocación de tokens](https://docs.livekit.io/frontends/reference/tokens-grants/#token-lifecycle).

Este código no inicia grabación, egress ni almacenamiento de las pistas. Los videos subidos a la galería siguen siendo archivos bajo demanda independientes. Revisar las opciones de retención y observabilidad del proveedor antes de una emisión real; identificadores de sala y participante contienen UUID, no nombres ni correos.

Si falla la limpieza remota de una sesión que ya había vencido, su fila puede quedar terminada aunque el proveedor todavía conserve la sala. La reserva siguiente revisa sesiones activas; no hay una cola persistente de reintentos para todas las salas históricas terminadas. Antes de repetir una emisión tras ese error, el propietario debe comprobar/cerrar la sala anterior en su consola. Detener la captura en el cliente y los tiempos de salida vacían salas sin participantes; no sustituyen el cierre de una sala que siga ocupada. Esta limitación de recuperación queda pendiente de una mejora específica y no debe presentarse como limpieza remota infalible.

No se configura aquí una cuota de audiencia, facturación, alta disponibilidad ni un límite distribuido de solicitudes. Antes de un evento público, el propietario debe revisar límites y protección de abuso de su plan/SFU y del endpoint. No se puede prometer capacidad ilimitada desde una página estática.

Para retirar a un administrador activo, detener primero su transmisión. Revocar membresía impide nuevas operaciones y credenciales pero no equivale por sí solo a desconectar participantes que ya estén en un SFU. El propietario puede cerrar una sala desde su consola si hace falta; una próxima reserva válida retirará también sesiones vencidas.

## Verificación realizada y activación pendiente

`node --test tests/native-live-backend.test.mjs` comprueba autorización, validación de entradas, firma criptográfica real, permisos y expiración de JWT, reserva en conflicto, comprobación de pistas, espectadores públicos, cierre y errores del proveedor. Estas pruebas usan respuestas Auth/DB/SFU simuladas; la comprobación de transporte WebRTC con cámaras y espectadores reales se realiza por separado.

La prueba de integración `npm run test:live` utiliza el SDK local 2.24.1 y el servidor oficial [LiveKit 1.13.11](https://github.com/livekit/livekit/releases/tag/v1.13.11), fijado como `livekit/livekit-server@sha256:25cd902de7cacbd5f1f779f6a6ac1eae20ba8f56b0935934ce6b0ab80d1e3d20`. La imagen declara origen `https://github.com/livekit/livekit`, revisión `385aa40f9292fe1db8caad87301e4b285b7c198a`, y su binario devuelve `livekit-server version 1.13.11`. El informe conserva esos datos, estados sanitizados del proveedor y contadores reales de recepción. La imagen y los participantes son efímeros; esta prueba no configura la cuenta pública.

El SFU desechable del ensayo local habilita `rtc.enable_loopback_candidate` y `rtc.use_mdns`: el emisor y los espectadores usan el mismo host de pruebas, y el espectador conserva la privacidad de sus candidatos sin otorgar permisos de captura. Estas opciones pertenecen al entorno de integración y no son una recomendación para cambiar la configuración de producción. Los diagnósticos guardan categorías de candidatos y estados ICE, sin direcciones IP ni SDP completo.

Se ejecutaron ambos SQL contra PostgreSQL 17.12 local efímero, sin red ni puertos publicados, con esquemas sintéticos Auth/Storage: instalación, RLS, rechazo de campos LIVE falsificados por un administrador, rechazo de RPC/tabla privada para el cliente, reserva única, confirmación, vista autorizada y finalización. Se repitieron las migraciones dos veces conservando los datos, y dos reservas concurrentes reales aceptaron únicamente una sesión. Esa prueba no sustituye la validación en el proyecto alojado real.

Antes de declarar la función activa en la nube: aplicar los SQL allí, configurar secretos del propietario, desplegar, emitir desde dos navegadores/dispositivos, comprobar video/audio recibido y corte del emisor, y probar permisos denegados. Hasta completar esa conexión, la activación de producción permanece pendiente.
