# COCHI — Experiencia web gastronómica

Sitio web responsive de Cochi Dark Kitchen construido a partir del ZIP de identidad entregado. Incluye la marca Cochi y la submarca Cochi Dulce, catálogo editable, filtros por categoría, fichas de producto, personalizaciones, carrito persistente y preparación del pedido para WhatsApp.

## 1. Qué incluye

- Landing editorial en colores extraídos de los logos originales: rojo `#EB140C`, crema `#E6E0BF`, rosa Cochi Dulce `#F1D6DF` y chocolate `#4B2928`.
- Logotipos e isotipos originales recortados únicamente para retirar el espacio transparente; no se redibujaron ni deformaron.
- Animación de entrada breve con una ilusión de guiño, que se muestra una vez por sesión y respeta `prefers-reduced-motion`.
- Productos y precios en USD transcritos del menú adjunto. Los platos para los que el ZIP no contiene una fotografía específica se muestran con un gráfico de marca, no con una foto engañosa.
- Cochi Dulce con marquesa de chocolate a `$2.50`; brownies y “una sorpresa dulce” figuran como novedades próximas sin compra ni precio inventado.
- Pollo asado restringido al domingo en el catálogo inicial.
- Categorías, búsqueda, disponibilidad, opciones requeridas, extras configurables con precio, cantidad, observaciones por artículo y notas del pedido.
- Carrito persistente en `localStorage`, con cantidades, edición de opciones y recálculo contra los precios del catálogo que se esté cargando.
- Formulario de cliente y mensaje completo de WhatsApp; el pedido no se marca como confirmado automáticamente.
- Endpoint de servidor `/api/bcv` con caché para consultar la API comunitaria BCV Today. Si falla, el navegador conserva la última tasa válida disponible y la marca como anterior cuando corresponde.
- Panel administrativo con inicio de sesión de Supabase Auth, editor visual de opciones y extras, selector de días, gestión del catálogo, subida de fotografías a Supabase Storage y ajustes del negocio. La edición en la nube se activa al configurar Supabase y sus políticas.
- Metadatos sociales, favicon, imágenes WebP optimizadas y ajustes responsive/accessibles.

## 2. Estructura de carpetas

```text
cochi/
├── api/
│   ├── bcv.js                 # Función de servidor para tasa BCV
│   └── config.js              # Expone solo configuración pública
├── public/
│   ├── index.html             # Sitio público
│   ├── styles.css             # Sistema visual y responsive
│   ├── app.js                 # Catálogo, carrito, WhatsApp y tasa
│   ├── admin.html             # Panel administrativo
│   ├── admin.js               # Acceso, catálogo y ajustes
│   ├── data/products.json     # Copia servida del catálogo base
│   └── assets/                # Branding, fotografías derivadas y OG image
├── supabase/
│   ├── schema.sql             # Tablas y políticas RLS/Storage
│   └── seed.sql               # Catálogo transcrito
├── scripts/
│   └── smoke-test.js          # Pruebas automáticas sin dependencias
├── .env.example               # Variables de ejemplo
├── package.json
├── server.js                  # Servidor local sin dependencias
├── vercel.json                # Cabeceras de seguridad y caché
└── README.md
```

## 3. Ejecutar localmente

Requisitos: Node.js 18 o superior.

1. Descomprime el ZIP del proyecto en una carpeta.
2. Abre una terminal dentro de esa carpeta.
3. Opcionalmente, copia `.env.example` como `.env` y revisa las variables. Sin Supabase configurado, el sitio público funciona con el catálogo local y la administración muestra los pasos pendientes.
4. Ejecuta:

```bash
npm run dev
```

5. Abre `http://localhost:4173`.
6. Ejecuta `npm test` para revisar catálogo, opciones, recursos y rutas HTTP. Usa `npm run check` para comprobar la sintaxis de JavaScript.

El proyecto no necesita `npm install` porque el servidor local usa módulos nativos de Node. La primera visita requiere conexión a internet para la fuente de Google Fonts y, si se desea conversión, para consultar la tasa.

## 4. Desplegar en Vercel

1. Sube la carpeta a un repositorio nuevo de GitHub (conserva la estructura completa, incluidas `api/`, `public/`, `supabase/` y `server.js`).
2. En Vercel, crea un proyecto desde ese repositorio. Usa la raíz del repositorio; no selecciones otra carpeta como raíz.
3. Para esta versión no hay comando de build ni dependencias de instalación. Si Vercel solicita un preset, elige **Other** y deja el comando de build vacío.
4. Añade las variables que correspondan desde **Project → Settings → Environment Variables** (ver sección siguiente).
5. Despliega. Las funciones de `api/` se sirven como endpoints de servidor y los archivos de `public/` como archivos estáticos.
6. Después de cada cambio de variables de entorno, vuelve a desplegar para que el runtime los lea.

## 5. Variables de entorno

Copia los nombres de `.env.example` a Vercel o a `.env` local. No pegues secretos en `public/`, `app.js`, `admin.js` ni en GitHub.

| Variable | Uso | Valor/decisión |
|---|---|---|
| `COCHI_WHATSAPP_NUMBER` | Número internacional centralizado | Referencia del menú: `584242246392`. Confirmar que sigue activo. Sin `+`, espacios o guiones. |
| `COCHI_WHATSAPP_CONFIRMED` | Indicador de que el contacto fue comprobado | `true` únicamente tras confirmar el número del negocio. |
| `COCHI_ORDER_MODES` | Modalidades disponibles inicialmente | `delivery,pickup` es una suposición visual de arranque; confirmar si Cochi ofrece ambas. |
| `COCHI_ORDER_MODES_CONFIRMED` | Indica que los modos se confirmaron | `true` solo después de validar las modalidades y zonas. |
| `DELIVERY_FEE_USD` | Cargo opcional de entrega | Vacío si Cochi debe confirmar el costo por WhatsApp; `0` significa cargo configurado en cero. |
| `SUPABASE_URL` | URL del proyecto Supabase | URL del proyecto, por ejemplo `https://xxxx.supabase.co`. |
| `SUPABASE_ANON_KEY` | Clave pública/anon de Supabase | Copiar desde Supabase API settings. No es una clave service-role; proteger datos con RLS. |
| `SUPABASE_STORAGE_BUCKET` | Bucket de fotos del catálogo | `cochi-products` por defecto. El esquema crea este bucket. |
| `BCV_API_URL` | Fuente JSON de la tasa | `https://bcv.today/api/v1/rate.json`. |
| `PORT` | Puerto del servidor local | `4173` por defecto; Vercel lo gestiona automáticamente. |

La URL y la anon/publishable key de Supabase son públicas por diseño; las políticas RLS del esquema limitan los cambios al usuario administrativo autorizado. **Nunca configures la clave service-role en el cliente ni la expongas.**

## 6. Activar la administración segura con Supabase

Sin este paso, el panel no puede guardar modificaciones en línea; el menú público seguirá usando `public/data/products.json` como catálogo inicial.

1. Crea un proyecto en Supabase y copia su Project URL y anon/publishable key a `SUPABASE_URL` y `SUPABASE_ANON_KEY`.
2. En **SQL Editor**, ejecuta primero `supabase/schema.sql`.
3. Luego ejecuta `supabase/seed.sql`. Esto carga/actualiza 30 registros iniciales del menú a partir de la fuente que proporcionaste.
4. En **Authentication → Users**, crea un usuario para quien administrará el menú. No se ha creado una contraseña por defecto.
5. Copia el UUID de ese usuario y ejecuta, sustituyendo el valor:

```sql
insert into public.admin_users(user_id)
values ('PEGA-AQUI-EL-UUID-DEL-USUARIO');
```

6. En la sección **Administración**, entra en `/admin.html` con ese correo/contraseña.
7. En **Ajustes del negocio**, verifica y guarda el número de WhatsApp, marca expresamente la casilla de verificación del número, selecciona solo las modalidades reales y marca la casilla de confirmación de modalidades/zonas. Si no marcas las casillas, la web mantiene el aviso correspondiente. No publiques hasta confirmar esos datos.
8. Para cargar fotos, el esquema prepara el bucket público `cochi-products` y limita las subidas a usuarios autorizados en `admin_users`. Sube una imagen JPG, PNG o WebP de hasta 5 MB y guarda el producto.

### Cómo editar el menú

Desde `/admin.html`, abre un producto para editar su nombre, descripción, categoría, precio USD, fotografía, disponibilidad, visibilidad, marca y personalizaciones, usando campos visuales. En **Opciones y personalizaciones**, crea un grupo como “Elige la salsa”, define si es obligatorio, selecciona si admite una o varias opciones y añade las alternativas con su suplemento. Para retirar una personalización, elimina ese grupo; para quitar una alternativa, usa “Quitar”. Los precios extra empiezan en cero y solo deben cambiarse si Cochi confirma un cargo adicional.

En **Días de disponibilidad**, elige todos los días, solo domingos o selecciona uno o varios días. Para el pollo asado se usa “Solo domingos”. Para un agotado temporal, desmarca “Disponible” y guarda. Para ocultar un producto sin borrarlo, usa “Ocultar”. Para brownies o una novedad todavía no lanzada, marca “Próximamente”; no asignes un precio comprable hasta que Cochi confirme su lanzamiento.

No agregues opciones ni extras que el negocio no ofrezca. Los cambios guardados en Supabase son los que consulta la web pública; `public/data/products.json` sirve como catálogo inicial/respaldo local y no se sincroniza automáticamente desde el navegador.

## 7. Conversión USD → bolívares / BCV

- Los precios base están almacenados en USD; los bolívares se calculan usando una sola tasa compartida por menú, carrito y mensaje.
- El backend consulta una API JSON comunitaria que indica obtener sus datos de `bcv.org.ve`. No es una API oficial operada por el BCV y depende de un tercero: https://bcv.today/api/ y https://bcv.today/api/v1/rate.json.
- El endpoint del proyecto evita consultas del navegador directamente al tercero y aplica caché de servidor. El navegador conserva la última tasa válida y su fecha; si no logra actualizar, usa ese valor con aviso de tasa anterior. Si nunca pudo obtener una tasa válida, muestra solo USD.
- La vigencia que devuelve la fuente es la que se muestra; fines de semana y días festivos pueden conservar una tasa cuya fecha de vigencia sea anterior. Revisa el aviso si el proveedor está atrasado.
- La conversión se redondea a dos decimales para mostrarla; el total se calcula en USD a partir del precio base y las opciones, y se convierte al mismo tipo de cambio para mantener la consistencia.

Si el proveedor deja de funcionar o cambia el formato, el menú debe continuar vendiendo en USD; no se inventa una tasa alternativa.

## 8. Decisiones y datos por confirmar antes de pedidos reales

1. **Número de WhatsApp:** `0424-2246392` se convierte a la forma internacional inicial `584242246392`. La web lo centraliza, pero aún debe confirmarse con el negocio. La página no puede verificar quién recibe el mensaje.
2. **Modalidades y zonas:** se muestran “Entrega a domicilio” y “Retiro” como valores iniciales. Confirmar si ambas se ofrecen, sectores de cobertura, horario y contacto de retiro. Estas opciones son editables desde ajustes.
3. **Cargo de entrega:** se deja “por confirmar con Cochi” si no se configura un importe; el total visible se identifica como total de productos y no simula un envío gratuito.
4. **Menú:** la marquesa de chocolate se interpreta como `$2.50` por la alineación del menú original. Confirmar este precio antes de abrir pedidos. Los restantes importes transcritos son los que aparecen en el menú proporcionado.
5. **Opciones confirmadas:** la bandeja de 3 carnes permite elegir tenders o alitas; la bandeja costilla y pollo permite elegir tenders o alitas; el arroz especial permite elegir papas o ensalada; las alitas permiten elegir agridulce, al ajillo, BBQ o clásicas. Se mantienen con el mismo precio porque el material no muestra suplementos.
6. **Pollo asado:** marcado solo para domingo. La promoción original también menciona encargo, pero no se habilitó pedido en otros días porque el menú principal indica “solo los domingos”; confirma si aceptar encargos cambia esa regla.
7. **Medios de pago:** no se añadieron métodos de pago ni precios de envío porque el ZIP no los documenta. Añádelos solo tras confirmación.
8. **Fotografía:** se han usado recortes de las fotografías promocionales originales disponibles para shawarmas y pollo asado. Para los demás platos no se inventó fotografía. Sustituye/agrega fotos reales desde el panel cuando estén disponibles.
9. **Previsualización social:** una vez tengas el dominio real, cambia `og:image` de `public/index.html` por la URL absoluta `https://TU-DOMINIO/assets/ui/og-cochi.jpg` (reemplaza el dominio de ejemplo).

## 9. Funcionalidades terminadas y límites actuales

### Funcionan en el catálogo local

- Landing responsive, animación de entrada y Cochi Dulce.
- Menú por categorías, búsqueda y disponibilidad dominical.
- Modales de producto, validación de opciones obligatorias, observaciones y cantidades.
- Carrito con añadir/editar/eliminar, subtotales, persistencia local y recálculo a partir del catálogo cargado.
- Formulario de cliente con campos condicionados por modalidad.
- Mensaje de WhatsApp completo y codificado. La pestaña abre el mensaje preparado; el cliente debe enviarlo dentro de WhatsApp.
- Consulta de tasa desde la función de servidor, caché local y aviso de dato anterior.

### Depende de configuración externa

- **Administración en línea:** requiere proyecto Supabase, SQL del esquema, variables de entorno y registrar explícitamente el UID en `admin_users`.
- **Subida de fotos:** requiere Supabase Storage y el bucket/políticas de escritura, creados por el esquema.
- **Catálogo compartido:** con Supabase configurado, el visitante ve el catálogo remoto. Sin conexión a Supabase, el catálogo local se muestra en modo respaldo y el panel no puede guardar.
- **Tasa BCV:** depende del tercero comunitario `bcv.today`; no puede garantizarse disponibilidad ni que el proveedor publique una actualización en el mismo instante que el BCV.
- **WhatsApp y entrega:** requieren verificación comercial humana. La página no puede verificar el número, pagar el envío, confirmar disponibilidad de reparto ni declarar un pedido confirmado.

### No se ha simulado

No hay pago en línea, notificaciones push, gestión de pedidos interna, seguimiento de repartidores ni inventario transaccional. WhatsApp es el canal de cierre elegido para esta versión; el mensaje listo no implica que Cochi haya recibido/aceptado el pedido.

## 10. Pruebas manuales recomendadas

- Añadir dos productos, editar cantidades, cambiar una opción y borrar una línea; actualizar la página y comprobar que el carrito persiste.
- Añadir una ración de alitas sin salsa y confirmar que no se permite; luego elegir una salsa y añadirla.
- Abrir el menú un día que no sea domingo y comprobar que el pollo asado aparece, pero no puede añadirse.
- Buscar por una palabra y filtrar categoría; comprobar el mensaje de lista vacía.
- Completar un pedido a domicilio sin dirección y sector: debe mostrar validación; completar los datos y comprobar el texto de WhatsApp antes de enviarlo.
- Probar el modo retiro y confirmar que no exige dirección. Los campos no usados se omiten del mensaje.
- Desconectar el proveedor de BCV o simular un error de red y comprobar que aparece la última tasa guardada con advertencia; borrar la tasa guardada para confirmar que queda solo USD.
- Abrir la página en móvil, probar el carrito inferior, cerrar/modificar productos, rotar pantalla y verificar que los modales no desborden.

---

**Importante:** antes de recibir pedidos reales, confirma el número comercial, las modalidades de entrega/retiro, cobertura, precio de la marquesa, precio/costo de envío y medios de pago. La implementación deja esos puntos visibles y configurables en lugar de inventarlos.
