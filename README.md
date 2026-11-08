# Cochi — carta digital sencilla (guía para principiantes)

Esta versión está pensada para que el cliente vea el menú, elija sus productos y nos escriba por WhatsApp. El cliente no necesita crear una cuenta. El panel privado de administración sí requiere variables de acceso y una base de datos Upstash conectada en Vercel. La web no cobra ni confirma pagos: el equipo de Cochi coordina por WhatsApp la disponibilidad, el monto final y el depósito.

## Novedades de esta versión

- **Animaciones tipo motion graphics:** intro con anillos, letras que saltan y cortina de salida; titulares que suben palabra por palabra; stickers que rebotan en el hero; franjas de tablero que se deslizan; tarjetas que aparecen en cascada; el producto vuela hacia el pedido al añadirlo. Todo respeta la opción "reducir movimiento" del teléfono.
- **Intro con guiño:** dura unos 5 segundos. El cerdito se agacha, guiña con párpado y trazo dibujados en SVG (ver `intro__wink-fx` en `index.html`), salen chispas y las letras de COCHI saltan. El tiempo total se cambia en `setupIntro` de `app.js` (valor 4900). La intro se ve una vez por sesión: para repetirla, abre el sitio en una pestaña nueva o privada.
- **Sello de actitud:** isotipo centrado en un círculo con el texto "Cochi desde el primer bocado" girando alrededor.
- **Ofertas al pedir, flyers y panel admin:** ver la sección "Panel de administración" más abajo.
- **Sin emojis ni símbolos especiales:** los iconos ahora son dibujos SVG (definidos al inicio de `index.html`) y el mensaje de WhatsApp sale en texto limpio.
- **Mejor en celular:** textos más grandes, botones de al menos 44 px, campos que no hacen zoom en iPhone, ficha de producto que sube desde abajo, botón de continuar siempre visible en el pedido y barra inferior que solo aparece cuando hay productos.
- **Errores corregidos:** logo de Cochi Dulce invisible (archivos intercambiados), carrito vacío mostrándose junto a los productos, cinta animada con hueco al final, carrito sin animación de cierre, fondo que se movía detrás del carrito, botón "Quiero algo dulce" que no hacía nada y precio del hero escrito a mano (ahora sale de `products.json`).

## Panel de administración

Desde `tu-sitio.com/admin/` (también funciona `tu-sitio.com/admin`) entras con tu correo y contraseña y puedes cambiar, sin tocar código:

- **Tasa y datos:** tasa BCV y su fecha, número de WhatsApp y costo de delivery.
- **Productos:** precio, foto, nombre, descripción, categoría, visible/disponible, destacado y "próximamente". También puedes agregar y eliminar productos.
- **Flyers:** imagen, título, texto, etiqueta (NUEVO, OFERTA...) y a dónde lleva el botón. Salen en la sección "Lo nuevo".
- **Comentarios:** testimonios de clientes (la sección se oculta si no hay ninguno visible).
- **Ofertas y avisos:** sugerencias al pedir con activación manual, fechas, franjas horarias y días de la semana; también frases de la barra roja superior.
- **Clientes:** registro privado en la nube con nombre, teléfono, correo opcional, dirección, sector, historial por teléfono y acceso directo a WhatsApp. Se registra el pedido al pulsar «Enviar por WhatsApp»; el envío y la confirmación siguen siendo gestionados por el equipo.
- **Comandas:** historial general de pedidos, con opciones, extras, notas, cupón, subtotal y datos de entrega. Cada pedido nuevo queda pendiente hasta que el equipo confirme el costo de delivery y el monto final.
- **Estadísticas:** ranking de productos, días y horas con más pedidos, franjas de actividad, pedidos pendientes, comandas confirmadas y monto de los pedidos cuyo precio fue confirmado. Puedes filtrar por 7, 30, 90 días o todo el historial.
- **Campañas por WhatsApp:** selección de clientes que autorizaron recibir promociones y generación de enlaces individuales con mensaje personalizado. Puedes retirar la autorización de un cliente desde el panel. No se envían mensajes automáticamente ni se contacta a quien no autorizó.
- **Permiso de promociones:** el cliente puede marcar una casilla opcional para aceptar ofertas por WhatsApp. No se marca por defecto.

Todo se guarda con el botón **Guardar cambios**. El panel muestra el error concreto del servidor si alguna sección falla; el contenido y los cupones se guardan en operaciones separadas. El sitio lo muestra en segundos. Las fotos se optimizan solas antes de subirse.

### Probarlo en tu computadora
1. Copia `.env.example` como `.env` y pon tu correo, una contraseña de al menos 8 caracteres y un `SESSION_SECRET` largo.
2. Ejecuta `npm run dev` y abre `http://localhost:4173/admin/`. Los cambios se guardan en la carpeta `storage/`.

### Si Vercel dice que superaste las 12 funciones del plan Hobby

Este proyecto queda preparado para crear **una sola función de servidor**: `api/handler.js`. El archivo `vercel.json` envía las direcciones `/api/...` a esa función y conserva la ruta original para que el panel, los pedidos, los clientes, los cupones y las imágenes sigan funcionando. No hace falta cambiar al plan Pro por este motivo.

**Importante:** no crees más archivos `.js` dentro de `api/`. Para agregar o modificar un endpoint, trabaja dentro de `lib/api.js` y mantén la única función `api/handler.js`. **Nunca empieces el nombre de ese archivo con `_` o `.`** (por ejemplo `_handler.js`): Vercel ignora esos archivos dentro de `api/`, no crea la función y todo `/api/*` responde `404 NOT_FOUND`. Sube la carpeta completa del proyecto actualizado al repositorio y deja que Vercel genere un despliegue nuevo.

### Ponerlo en Vercel (paso 3)
Vercel no permite guardar archivos en el servidor, por eso el panel usa una base de datos gratuita de Upstash:
1. En tu proyecto de Vercel entra a **Storage**, elige **Upstash for Redis** (plan gratis) y conéctalo al proyecto. Vercel agrega solo las variables `KV_REST_API_URL` y `KV_REST_API_TOKEN` (el proyecto también reconoce `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN`).
2. En **Settings > Environment Variables** agrega `ADMIN_EMAIL`, `ADMIN_PASSWORD` y `SESSION_SECRET` (los mismos de `.env.example`).
3. Vuelve a desplegar y entra a `/admin/`.

### Seguridad y cuidados
- La contraseña vive solo en las variables de entorno, nunca en el código. Para cambiarla, cambia la variable y vuelve a desplegar.
- La sesión dura 12 horas, se guarda en una cookie protegida y hay límite de intentos de entrada.
- El sitio público no enlaza al panel, y el panel pide `noindex` a los buscadores.
- Si la base de datos no responde, el sitio sigue funcionando con los valores de `public/data/`.
- Lo que guardas desde el panel tiene prioridad sobre `public/data/*.json`.

## Comandas, estadísticas y campañas

En el panel privado aparecen tres pestañas nuevas:

- **Comandas:** cada pedido enviado a WhatsApp queda como pendiente. Abre «Agregar delivery y confirmar», escribe el costo real de entrega (en retiro se toma $0), y pulsa «Confirmar monto e imprimir comanda». El sistema guarda el monto y calcula el total final una sola vez. Las comandas confirmadas pueden imprimirse otra vez.
- **Impresión de prueba:** la vista de impresión usa ancho de papel de 58 mm, texto compacto y contenido en blanco y negro. En el diálogo del navegador selecciona la impresora térmica, el papel/rollo de 58 mm, márgenes mínimos o ninguno y desactiva encabezados y pies de página. La impresión es una prueba desde el navegador; no requiere instalar un servicio de impresión en el servidor.
- **Estadísticas:** usa la fecha de recepción del pedido y la zona horaria de Caracas. El monto total solo suma pedidos cuyo precio y delivery fueron confirmados por el equipo; los pendientes se muestran por separado. Esta cifra no significa necesariamente que el depósito ya fue recibido.
- **Clientes y campañas:** marca únicamente a las personas que autorizaron promociones por WhatsApp. El botón «Preparar mensajes» crea un enlace personalizado para cada persona seleccionada; revisa y envía cada conversación desde WhatsApp. «Retirar autorización» excluye al cliente de futuras selecciones.

Los registros se guardan en el mismo almacenamiento Upstash conectado al proyecto de Vercel. No hace falta crear otra cuenta, tabla ni servicio para esta ampliación. En modo local, se guardan dentro de la carpeta `storage/`. Los pedidos anteriores que ya estaban dentro del historial de clientes se incorporan a la vista general; las versiones previas conservaban hasta 30 pedidos por cliente, por lo que el historial más antiguo que ya no existía en ese registro no se puede reconstruir.

## Etiquetas, WhatsApp flotante, confirmación, fechas y app instalable

- **Etiquetas de producto:** en el panel, dentro de "Editar" de cada producto, escribe una etiqueta corta (Nuevo, Más pedido, Picante...). Sale sobre la foto en el menú y en la ficha del producto.
- **Botón flotante de WhatsApp:** abre un chat con un mensaje de "tengo una duda". Se acomoda solo para no tapar la barra del pedido. El número sale de los ajustes del panel.
- **Pantalla de confirmación:** antes de abrir WhatsApp, el cliente revisa su pedido, sus datos y los pasos que siguen. Si llenas "Datos para el depósito" en la pestaña Tasa y datos, aparecen con un botón para copiarlos. El mensaje de WhatsApp lleva el detalle con precios estimados.
- **Fechas de inicio y fin:** los flyers y las sugerencias al pedir tienen "Desde" y "Hasta" (opcionales). El panel te dice si están Programados, Vigentes o Vencidos, y el sitio los muestra u oculta solo, con hora de Caracas. Un flyer con fecha final muestra "Válido hasta el...".
- **Vista previa al compartir:** WhatsApp y las redes necesitan la dirección completa del sitio. En Vercel se toma sola al publicar. Si usas dominio propio, agrega la variable `SITE_URL` (por ejemplo `https://cochi.com`). La imagen está en `public/assets/ui/og-cochi.jpg` (1200 x 630). Si cambias el link, WhatsApp guarda la vista previa anterior un tiempo; puedes forzar la actualización con el depurador de Facebook.
- **App instalable:** en Android aparece el botón "Instalar Cochi en mi celular" en el pie de página. En iPhone el botón explica cómo usar "Compartir > Añadir a pantalla de inicio". Si no hay internet, se muestra una pantalla de "Sin conexión". La app **nunca guarda precios, menú ni ofertas**: siempre los pide a internet para que no se vea información vieja.

## Accesibilidad

Se revisó el sitio con una auditoría automática y con pruebas de teclado. Lo que quedó resuelto:

- Anillo de enfoque visible en todo (claro y oscuro) y navegación completa con teclado.
- Carrito y ficha de producto: el foco queda dentro, Escape los cierra y el foco regresa al botón que los abrió. El resto de la página queda bloqueado mientras el carrito está abierto.
- La intro se puede saltar con Escape, Enter o Espacio, y también con un toque.
- Botón "Pausar animaciones" en el pie de página (se recuerda) y respeto de la preferencia de movimiento reducido del teléfono. La cinta roja se detiene al pasar el cursor o enfocarla.
- Contraste de texto de al menos 4.5:1 (se usó un rojo más profundo, `--red-ink`, para textos pequeños sobre crema, y blanco para textos pequeños sobre rojo).
- Botones y enlaces de al menos 44 x 44 px en celular.
- Errores del formulario enlazados al campo, categorías con estado "pulsado" y flyers con enlaces que dicen a qué flyer pertenecen.

Pendiente recomendado: probar el sitio con un lector de pantalla real (VoiceOver en iPhone y TalkBack en Android), porque la auditoría automática no sustituye esa prueba. Al subir fotos nuevas desde el panel, el texto alternativo se genera con el nombre del producto o el título del flyer: usa nombres claros.

## Si al abrir `/admin` aparece `404 NOT_FOUND`

La ruta `/admin` se envía directamente a `public/admin/index.html` mediante una regla de rewrite en `vercel.json`. También puedes abrir `tu-sitio.com/admin/` con la barra final. Después de subir un cambio en `vercel.json`, espera a que Vercel termine el nuevo despliegue.

## Si el login del panel dice "El servidor respondió 404 … NOT_FOUND"

Es el 404 de Vercel (no de la app): la función `api/handler.js` no se creó. Comprueba que ese archivo exista, que su nombre **no empiece con `_` ni `.`** y que `vercel.json` lo use en el rewrite de `/api/:path*`. Luego abre `tu-sitio.com/api/health`: si responde `{"ok":true,...}`, la función ya está viva. Si sigue en 404, en Vercel entra a **Deployments > el último > Functions** y confirma que aparezca `api/handler`.

## Si el panel muestra `404 NOT_FOUND` en Clientes, Comandas o Estadísticas

Ese error significa que Vercel no encontró una ruta API; no demuestra por sí solo que se hayan perdido los datos ni que Upstash esté desconectado. Esta versión usa una sola función (`api/handler.js`) y una regla de rewrite para atender todos los endpoints bajo `/api/`. Así se evita crear una función independiente por archivo y se mantiene el proyecto dentro del límite del plan Hobby. La lógica de todas las rutas sigue centralizada en `lib/api.js`; clientes, comandas, sesiones, contenido, cupones, imágenes y pedidos conservan sus mismas direcciones. Después de subirla, Vercel debe crear un nuevo despliegue desde el repositorio.

Si el panel deja de mostrar el `404` pero aparece un mensaje indicando que la base de datos no está conectada, entra en **Storage** y confirma que Upstash Redis esté conectado al proyecto. En **Settings > Environment Variables** deben existir `KV_REST_API_URL` y `KV_REST_API_TOKEN` (o sus equivalentes `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN`). Después haz **Redeploy**. No pegues esos valores en mensajes ni en GitHub. La versión corregida muestra un `503` claro en vez de mostrar falsamente cero clientes o pedidos cuando no hay almacenamiento conectado.

## Si Vercel muestra "500 FUNCTION_INVOCATION_FAILED"

Ese mensaje significa que una función del servidor se cayó. Para saber cuál y por qué:
1. En la misma pantalla de error toca **VIEW LOGS** (o entra a tu proyecto en Vercel y abre **Logs**, filtrando por **Error**). La primera línea roja dice la causa.
2. Abre `tu-sitio.com/api/health`. Si responde algo como `{"ok":true,"storage":"kv","adminConfigured":true}`, la función funciona. `storage` debe decir `kv` (base de datos conectada) y `adminConfigured` debe decir `true` (variables del panel listas). Si dice `none` o `false`, falta conectar Upstash o agregar las variables (paso 3 del panel).
3. En **Settings > General** del proyecto, "Framework Preset" debe ser **Other** y "Output Directory" debe ser `public` (el archivo `vercel.json` ya lo indica).
4. Tras cambiar variables de entorno hay que volver a desplegar (Redeploy).

## Lo más importante

- El cliente explora el menú y añade productos al pedido.
- El pedido se envía a WhatsApp con los productos, cantidades, opciones y datos de entrega, con **factura en texto limpio: número de pedido, precio por producto y descuento de cupón**. El total final con entrega y el monto en Bs. los da Cochi por el chat.
- El equipo de Cochi confirma por WhatsApp el monto, el costo de entrega y cómo pagar.
- **La preparación comienza únicamente después de recibir el depósito acordado.**
- La web acepta solicitudes de viernes a domingo. Fuera de esos días, el cliente puede mirar el menú, pero el botón para continuar estará desactivado.
- Los productos y la tasa se pueden editar desde el panel privado; los archivos de `public/data/` sirven como valores iniciales o respaldo cuando no hay contenido guardado.

## Cómo cambiar la tasa del dólar (lo más frecuente)

1. Abre tu repositorio de Cochi en **GitHub**.
2. Entra en la carpeta `public`, luego `data`, y abre `settings.json`.
3. Pulsa el lápiz **Edit** (Editar).
4. Busca estas dos líneas:

   ```json
   "usdToVes": 887.302,
   "exchangeRateDate": "2026-10-27",
   ```

5. Cambia el número de `usdToVes` por la tasa que usarán y cambia la fecha de `exchangeRateDate` al día de vigencia, en formato `AAAA-MM-DD`. Por ejemplo, la fecha 27 de octubre de 2026 se escribe `2026-10-27`.
6. No borres las comillas de la fecha ni la coma al final de la línea del número.
7. Pulsa **Commit changes** para guardar. Si GitHub pregunta otra vez, confirma el guardado.
8. Vercel normalmente publicará el cambio automáticamente. Cuando termine, abre la web y actualízala con `Ctrl + F5`.

**Importante:** la web viene con una tasa de referencia de Bs. 887,302 con fecha 27/10/2026, solo como punto de partida. Verifica que sea la que deseas aplicar antes de publicar. La tasa es manual: si el BCV publica un valor nuevo —incluyendo una tasa que entre en vigor al siguiente día hábil—, el equipo debe actualizar el número y la fecha en este archivo. La web no depende de que el proveedor externo funcione ni se queda esperando que una API actualice los datos el fin de semana.

## Cómo cambiar el WhatsApp de pedidos

En el mismo archivo `public/data/settings.json`, busca:

```json
"whatsappNumber": "584242246392",
```

Coloca el número correcto con código de país, solo números, sin espacios ni `+`. El número que viene en el archivo procede de la información anterior del menú; **verifícalo antes de publicar o repartir el enlace**. Por ejemplo, un número venezolano debe comenzar con `58` seguido del número sin el cero inicial.

## Cómo cambiar un producto o su precio

1. En GitHub, abre `public/data/products.json`.
2. Usa `Ctrl + F` y busca el nombre del producto.
3. En el mismo bloque del producto puedes cambiar campos como:
   - `"name"`: nombre que ve el cliente.
   - `"description"`: descripción.
   - `"price_usd"`: precio base en dólares, solo el número, sin `$`.
   - `"available"`: `true` para disponible o `false` para agotado.
   - `"is_visible"`: `true` para mostrarlo o `false` para ocultarlo del menú.
4. Pulsa **Commit changes**. Vercel publicará el cambio automáticamente si el repositorio está conectado.

Para que la web funcione correctamente, conserva las comillas, comas, llaves y los nombres de los campos. Si solo vas a cambiar la tasa, no hace falta tocar `products.json`.

## Cómo cambiar textos, títulos o imágenes

- Los textos principales están en `public/index.html`.
- Los estilos y animaciones están en `public/styles.css`.
- El comportamiento del carrito y WhatsApp está en `public/app.js`. Si no estás segura/o de qué modificar, no cambies este archivo para actualizar la tasa ni los precios.
- Las imágenes de marca están en `public/assets/brand/` y las de productos en `public/assets/food/`.

## Cómo probar la web en tu computadora (opcional)

Solo necesitas instalar Node.js una vez. Después:

1. Descomprime el ZIP en tu computadora.
2. Abre la carpeta `cochi-proyecto`.
3. Haz clic en la barra de dirección de esa carpeta, escribe `cmd` y pulsa Enter.
4. En la ventana negra, escribe `npm run dev` y pulsa Enter.
5. Abre el enlace `http://localhost:4173` en tu navegador.
6. Para cerrar la prueba, vuelve a la ventana negra y pulsa `Ctrl + C`.

No hace falta `npm install`: el proyecto no utiliza paquetes externos para funcionar localmente.

## Antes de compartir la web con clientes

- Confirma que el número de WhatsApp de `settings.json` sea el correcto.
- Confirma la tasa y la fecha que el equipo quiere aplicar.
- Revisa nombres, fotos y precios del menú.
- Prueba añadir un producto y enviar el pedido a WhatsApp.
- Recuerda que la preparación se inicia solo después de recibir el depósito acordado.

## Estructura sencilla

```text
cochi-proyecto/
├── public/
│   ├── index.html          # Página y textos principales
│   ├── app.js              # Carrito y envío a WhatsApp
│   ├── styles.css          # Diseño, móvil y animaciones
│   ├── data/
│   │   ├── settings.json   # WhatsApp y tasa manual
│   │   └── products.json   # Menú, descripciones y precios
│   └── assets/             # Logos, isotipos e imágenes
├── api/handler.js        # Única función API; vercel.json desvía aquí todos los /api/*
├── lib/api.js              # Lógica única: sesión, validación y almacenamiento
└── scripts/dev-server.js   # Servidor SOLO para probar en tu computadora
└── vercel.json             # Reglas de publicación
```

## Cupones (prueba)

En el panel, pestaña **Cupones**: interruptor general, y por cada cupón: código, % o monto fijo, usos máximos, pedido mínimo, un uso por cliente, teléfono exclusivo y fechas. Los cupones viven en una clave privada de la base de datos (no salen en el contenido público). Todas las rutas del menú y del panel pasan por la única función de API de Vercel; `lib/api.js` decide qué hacer según la dirección y el método de cada solicitud. El uso se cuenta al pulsar "Enviar por WhatsApp". Requiere la base de datos Upstash conectada.

## Horario de pedidos

En el panel, pestaña **Horario**: cada día se abre o se cierra, con hora de apertura y cierre (hora de Caracas), y hay un interruptor para **pausar pedidos** de inmediato. Los textos del sitio que dicen cuándo se piden pedidos y la factura se actualizan solos. Las frases de la barra roja se editan en "Ofertas y avisos".


### Registro de clientes y ofertas por horario

Los pedidos enviados a WhatsApp se registran en la base de datos del servidor. El registro de clientes se encuentra en la pestaña **Clientes** del panel y solo se consulta después de iniciar sesión. El teléfono es obligatorio para asociar pedidos; el correo es opcional. La casilla de autorización de promociones está desmarcada por defecto. No uses los datos para campañas si la persona no dio su autorización.

En **Ofertas y avisos**, cada sugerencia puede limitarse a una hora de inicio y fin y a días concretos. Si dejas las horas vacías y no marcas días, la sugerencia conserva su disponibilidad habitual. El interruptor **Activa** permite pausarla sin eliminarla.
