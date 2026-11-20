# Cochi · Versión 3: qué cambió y cómo publicarlo

Esta carpeta es tu proyecto completo de Cochi, ya actualizado con el pulido de interfaz, micro-animaciones, experiencia de usuario (UX) y mejoras de productividad en el panel administrativo. **No se borró nada de lo que ya funcionaba**: el menú, los pedidos por WhatsApp, el panel, los cupones, los temas y la comanda de 58 mm siguen igual. Solo se agregaron mejoras.

Tus datos (productos, precios, tasa, pedidos, clientes, fotos y cupones) **no se tocan**: viven en la base de datos de Vercel (Upstash), no en estos archivos.

---

## Cómo subirlo a GitHub (paso a paso, sin programar)

> Tiempo aproximado: 10 minutos.

1. **Descomprime el ZIP** en tu computadora (clic derecho > *Extraer todo*). Te queda una carpeta llamada `cochi-proyecto`.
2. Entra a tu repositorio en GitHub: `https://github.com/CochiDarkitchen/cochi`
3. Pulsa el botón **Add file** (arriba a la derecha, junto al botón verde *Code*) y elige **Upload files**.
4. Abre la carpeta `cochi-proyecto` en tu computadora, **selecciona todo lo que hay DENTRO** (Ctrl + A) y arrástralo a la ventana de GitHub.
   - ⚠️ Importante: arrastra el **contenido** de la carpeta (las carpetas `api`, `lib`, `public`, `scripts` y los archivos sueltos), **no** la carpeta `cochi-proyecto` entera. Si arrastras la carpeta entera, GitHub crea una subcarpeta y Vercel no encontrará la página.
5. Espera a que terminen de cargar todos los archivos (la barra de progreso desaparece).
6. Abajo, en **Commit changes**, escribe un título como: `Versión 2: mejoras de menú y panel`.
7. Deja marcada la opción **Commit directly to the main branch** y pulsa el botón verde **Commit changes**.
8. Vercel publicará la nueva versión **solo** en 1 o 2 minutos. Puedes verlo en vercel.com > tu proyecto > **Deployments** (debe decir *Ready* en verde).

### Comprobar que todo quedó bien

1. Abre `https://cochi.vercel.app` en tu celular. Si ves la versión anterior, actualiza la página (o ábrela en una pestaña de incógnito).
2. Baja hasta el menú: debe verse dividido por secciones (Costillas, Shawarmas…) con una barra de categorías que se queda fija arriba.
3. Entra al panel: `https://cochi.vercel.app/admin`. Ahora abre en la pestaña **Inicio**.
4. Abre `https://cochi.vercel.app/api/health`. Debe decir `"ok":true`.

### Si algo sale mal: volver a la versión anterior

En Vercel entra a **Deployments**, busca el despliegue anterior (el de antes de hoy), pulsa los tres puntos **⋯** y elige **Promote to Production** (o **Instant Rollback**). En segundos vuelve la versión anterior. Tus datos no se pierden.

---

## Qué mejoró para tus clientes

| Mejora | Por qué ayuda a vender |
|---|---|
| **Menú por secciones** con títulos grandes (Costillas, Shawarmas, Bandejas…) | El cliente encuentra lo que quiere sin perderse en una lista larga. |
| **Barra de categorías fija** que se ilumina según la sección en la que estás | Saltar de "Shawarmas" a "Bebidas" es un solo toque. |
| **Tarjetas tipo app de delivery en el celular** (texto a la izquierda, foto a la derecha) | Caben más platos por pantalla, como en las apps que ya conocen. |
| **Botón "Añadir +" directo** en platos sin opciones, con contador **− 2 +** en la misma tarjeta | Menos pasos = más pedidos. Los platos con opciones (o con la promo de papas) siguen abriendo su ficha para no perder esa venta. |
| **Estado en vivo:** "Abierto ahora · Pedidos hasta las 10:00 p. m." o "Cerrado ahora · Abrimos el viernes a las 12:30 p. m." | El cliente sabe al instante si puede pedir. |
| **"¿Lo de siempre?"**: repetir el último pedido con un toque | Los clientes que vuelven piden en segundos. |
| **"Completa tu pedido"** en el carrito: papas, refrescos y postre con un toque | Sube el ticket promedio. |
| **El formulario recuerda los datos** del cliente en su propio teléfono (puede borrarlos cuando quiera) | No tiene que escribir nombre y dirección cada vez. |
| **El botón de la ficha muestra el total**: "Añadir · $18.00" | Sin sorpresas: ve cuánto suma con sus opciones y la cantidad. |
| **Compartir un plato** por WhatsApp o redes: el enlace abre directo la ficha de ese plato | Tus clientes te hacen publicidad. |
| **Búsqueda que entiende sin acentos** ("cesar" encuentra "César") | Menos "no encontrado". |
| **La intro animada sale una vez por semana** (antes, cada vez que abrían el enlace) y nunca cuando llegan desde un plato compartido | El cliente con hambre no espera 5 segundos cada vez. |
| **Aviso de tasa una sola vez** arriba del menú (antes se repetía "· tasa anterior" en cada plato) | Menú más limpio. |
| **Botón "Vaciar pedido"** y "Ya lo envié · empezar un pedido nuevo" | Menos confusión después de enviar. |
| **Filtros rápidos de antojo** (`🔥 Favoritos`, `🍟 Con promo`, `🍖 Para compartir`, `💸 Hasta $8`, `🍫 Postres`) y botón **×** para limpiar búsqueda | El cliente filtra en un toque según su presupuesto o antojo, y ahora los postres de Cochi Dulce también aparecen en el buscador y en la barra de categorías. |
| **Píldoras de promoción y personalización en cada tarjeta** (`+ Ración de papas pequeña por $1.00`, `A tu gusto`) y contador en platos con opciones (`1 Elegir +`) | El cliente descubre la promo de papas desde el menú antes de abrir el plato y sabe cuántos lleva en su pedido. |
| **Ficha de producto interactiva** con estado `✓ LISTO` al completar opciones obligatorias y auto-scroll con aviso visual si olvida elegir una opción | Cero frustración al armar bandejas, alitas o combos con opciones. |
| **Carrito con barra de progreso de 3 pasos** (`1. Tu pedido → 2. Tus datos → 3. Confirmar`), miniaturas de foto y **banner de ahorro total** (`¡Estás ahorrando $X.XX!`) | Flujo de compra claro, visual y con refuerzo positivo del ahorro. |
| **Botón "Saltar intro →"** visible desde el primer segundo y coreografía más ágil | Quien entra con prisa salta directo al menú con un toque. |

**Errores corregidos:** el horario decía "8:00 p. m.." (doble punto); las cantidades de opciones saltaban de dos en dos si se abría la misma ficha varias veces.

## Qué mejoró para ti y tu equipo (panel `/admin`)

- **Nueva pestaña "Inicio"** (la primera que ves al entrar):
  - Estado de la tienda en grande (abierta, cerrada o en pausa) y botón **"Pausar pedidos ahora"** con un toque.
  - Resumen del día: pedidos por confirmar, en curso, pedidos de hoy y monto confirmado hoy.
  - Lista de pedidos que esperan confirmación.
  - **Tasa del día** con aviso si la fecha no es de hoy.
  - **"¿Qué hay hoy?"**: toca un producto para marcarlo agotado o disponible.
  - Lo más pedido de la semana.
- **Comandas con seguimiento completo:** Por confirmar → Confirmada → En preparación → En camino (o Lista para retirar) → Entregada. También **Cancelar** (con motivo) y **Reactivar**.
- **Mensajes de WhatsApp listos** en cada comanda según su estado: "Recibimos tu pedido", "Total y datos de pago", "En preparación", "En camino / Listo para retirar" y "¿Qué tal estuvo?". Solo los abre; tú decides si enviarlos.
- **Aviso de pedido nuevo:** la lista se actualiza sola cada 30 segundos, suena un aviso (lo puedes apagar) y la pestaña del navegador muestra cuántos esperan, por ejemplo **(2) Panel Cochi**.
- **Filtros y búsqueda en comandas:** activas, por confirmar, en curso, entregadas, canceladas, "solo hoy" y búsqueda por nombre, teléfono o número.
- **Teléfono y "Ver en mapa"** en cada comanda con un toque. Los números 0412… se convierten solos a 58412… para que WhatsApp los abra bien.
- **Descargar para Excel** las comandas y los clientes.
- **Productos:**
  - Filtros: agotados, ocultos, sin foto y destacados.
  - Flechas **↑ ↓** para cambiar el orden dentro de su categoría.
  - **Duplicar** un producto (la copia queda oculta hasta que la revises).
  - **Días en que se vende** (por ejemplo, solo domingos).
  - **Editor de opciones:** grupos como "Elige tu salsa" o "Tenders o alitas", obligatorios u opcionales, de una o varias opciones, con precio extra. El panel no te deja guardar si un grupo quedó vacío.
- **Clientes:** ordenar por pedido más reciente, más pedidos, mayor gasto o nombre; total gastado por cliente; etiqueta **"Cliente frecuente"** (3 pedidos o más).
- **Estadísticas:** ya no suman los pedidos cancelados; nueva gráfica de **ventas confirmadas por día** (últimos 14 días).
- **Nuevo en Versión 3 (Panel `/admin`):**
  - **Barra superior en vivo y pestañas con contadores:** muestra en todo momento si la tienda está `Abierta / Cerrada / En pausa`, la tasa BCV activa, y globos de alerta en las pestañas `Comandas` (pedidos por confirmar) y `Productos` (platos agotados).
  - **Diseño amplio en computadora (`1080 px`)** y **Vista compacta / detallada** en Comandas para ver 2 columnas de pedidos en horas pico.
  - **Botones de monto rápido de delivery en 1 toque** (`Gratis $0`, `$1`, `$1.5`, `$2`, `$2.5`, `$3`, `$4`, `$5`) en cada comanda por confirmar.
  - **Botón "Copiar cobro"** en cada comanda para copiar al portapapeles el desglose en USD, Bs. y datos de pago con un clic, más alerta visual (`⏱`) si un pedido lleva más de 10 minutos esperando confirmación.
  - **Checklist operativo en Inicio:** verifica de un vistazo si la tasa BCV tiene fecha de hoy, si los datos de pago están listos y cuántos platos tienen fotografía, más buscador instantáneo y botón **"Activar todos"** en *¿Qué hay hoy?*.
  - **Filtro por categoría y vista previa en vivo** dentro del editor de cada producto para ver cómo lucirá la tarjeta en el menú en USD y Bs.
  - **Gráfica vertical de barras de 14 días**, porcentaje de conversión y desglose Delivery vs. Retiro en *Estadísticas*.
- **Atajo:** Ctrl + S guarda los cambios.

## Recomendaciones de diseñador (no requieren programar)

1. **Sube fotos de los platos desde el panel.** Hoy solo 3 de 27 platos tienen foto. En los menús digitales, los platos con foto se piden mucho más. Usa el filtro **"Sin foto"** en Productos. Consejo: foto con luz natural, de frente o desde arriba, sobre fondo limpio.
2. **Actualiza la tasa cada día de apertura** desde **Inicio > Tasa del día**. Si la fecha no es de hoy, el menú muestra un aviso a tus clientes.
3. **Escribe los "Datos para el depósito"** en *Tasa y datos*. Así el mensaje "Total y datos de pago" de cada comanda sale completo.
4. **Usa "Destacado" en 3 platos estrella** (la sección "Los que se antojan") y etiquetas cortas como *Más pedido* o *Nuevo*.

## Archivos que cambiaron (por si tu programador lo necesita)

- `public/index.html`, `public/app.js`, `public/styles.css`: menú del cliente.
- `public/admin/index.html`, `public/admin/admin.js`, `public/admin/admin.css`: panel.
- `lib/api.js`: nuevos estados de comanda (`preparing`, `ready`, `delivered`, `cancelled`) en `PUT /api/admin/orders/:id` con `{ "status": "..." }`. Lo anterior sigue funcionando igual.
- `scripts/smoke-test.js`: prueba nueva para los estados.
- Nuevos: `LEEME-PRIMERO.md`, `.env.example`, `.gitignore`.
- Los estilos nuevos están al final de `styles.css` y `admin.css`, bajo el título **VERSIÓN 2**.

Se mantiene **una sola función de servidor** (`api/handler.js`), así que sigue dentro del plan gratis (Hobby) de Vercel. No hace falta cambiar variables de entorno ni la base de datos.
