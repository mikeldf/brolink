# BroLink

![Logotipo de BroLink](brolink-logo.svg)

BroLink es una web privada pensada para que dos personas compartan archivos, enlaces y notas. Incluye inicio de sesión, estado conectado/desconectado, actualización sin recargar la página, favoritos, papelera, perfiles y almacenamiento externo en Drime.

La versión original está publicada en [brolink.vercel.app](https://brolink.vercel.app). Este repositorio es privado y contiene el código necesario para conservar el proyecto y preparar otra instalación.

## Funciones principales

- Acceso con correo y contraseña o con Google.
- Envío de archivos pequeños y grandes; los grandes se dividen en bloques de 5 MB.
- Envío de enlaces y mensajes.
- Actualización entre los dos usuarios mediante Supabase Realtime Broadcast.
- Estado en línea mediante Supabase Realtime Presence.
- Previsualización local de imágenes antes de enviarlas.
- Estados nuevo, visto y descargado.
- Favoritos y papelera independientes para cada usuario.
- Borrado definitivo por el remitente, incluido el archivo real en Drime.
- Foto de perfil privada en Supabase Storage.

## Arquitectura

| Parte | Servicio | Responsabilidad |
|---|---|---|
| Interfaz | HTML, CSS y JavaScript | Pantallas, envío y actualización de datos |
| Autenticación y datos | Supabase | Usuarios, perfiles, elementos, estados y Realtime |
| Avatares | Supabase Storage | Fotos de perfil privadas |
| Archivos | Drime | Almacenamiento y descarga de los archivos compartidos |
| API privada | Vercel Functions | Protege el token de Drime y valida la sesión de Supabase |
| Proxy de subida | Supabase Edge Functions | Evita problemas de CORS durante las subidas a Drime |
| Publicación | Vercel | Aloja la web y despliega cada cambio de `main` |

## Estructura del repositorio

```text
.
├── api/
│   ├── drime.js
│   └── status.js
├── supabase/
│   ├── functions/drime-upload/index.ts
│   ├── config.toml
│   └── schema.sql
├── .env.example
├── .gitignore
├── app.css
├── app.js
├── brolink-icon.svg
├── brolink-logo.svg
├── index.html
└── vercel.json
```

## Antes de empezar

Para crear una instalación independiente necesitas:

1. Una cuenta de GitHub.
2. Un proyecto de Supabase.
3. Un proyecto OAuth de Google si quieres el botón **Continuar con Google**.
4. Una cuenta de Drime con token de acceso y el identificador del workspace.
5. Una cuenta de Vercel.
6. Node.js si vas a usar las herramientas de línea de comandos.

> Este proyecto está diseñado para dos usuarios. Si entran más de dos cuentas, la interfaz elegirá como destinatario el primer perfil distinto al usuario actual. Para grupos hace falta añadir un selector de destinatario.

## Instalación completa

### 1. Copiar el repositorio

Desde GitHub, usa **Fork** o crea un repositorio privado nuevo. También puedes clonarlo:

```bash
git clone https://github.com/TU_USUARIO/brolink.git
cd brolink
```

Mantén el repositorio privado si contendrá información sobre tu instalación. Las claves privadas nunca deben subirse, aunque el repositorio sea privado.

### 2. Crear Supabase y su base de datos

1. Crea un proyecto en Supabase.
2. Abre **SQL Editor**.
3. Copia y ejecuta todo el contenido de [`supabase/schema.sql`](supabase/schema.sql).
4. Comprueba en **Table Editor** que existen `profiles`, `items` e `item_user_state`.
5. Comprueba en **Storage** que existe el bucket privado `avatars`.

El SQL activa Row Level Security. Un usuario solo puede leer elementos donde sea remitente o destinatario, el remitente es quien puede borrar definitivamente y cada persona administra únicamente sus propios favoritos y papelera.

### 3. Conectar el frontend con tu Supabase

En Supabase, abre el cuadro **Connect** y copia:

- Project URL: `https://TU_PROJECT_REF.supabase.co`
- Publishable key: `sb_publishable_...`

En `app.js`, sustituye las constantes del principio:

```js
const SURL = 'https://TU_PROJECT_REF.supabase.co';
const SKEY = 'sb_publishable_TU_CLAVE_PUBLICA';
```

Usa únicamente la clave **publishable** en el navegador. No coloques una secret key ni una antigua `service_role` en `app.js`.

### 4. Configurar el acceso por correo

En Supabase abre **Authentication → Providers → Email** y decide si exigirás confirmación por correo. La pantalla de BroLink ya permite registrarse, iniciar sesión y solicitar un cambio de contraseña.

Cuando el primer y el segundo usuario se registren, el disparador `on_auth_user_created` creará sus perfiles automáticamente.

### 5. Configurar Google OAuth

1. En Google Cloud crea o elige un proyecto.
2. Configura la pantalla de consentimiento OAuth.
3. Crea credenciales de tipo **OAuth client ID → Web application**.
4. En **Authorized JavaScript origins** añade:

   ```text
   https://TU_PROYECTO.vercel.app
   ```

5. En **Authorized redirect URIs** añade el callback exacto de Supabase:

   ```text
   https://TU_PROJECT_REF.supabase.co/auth/v1/callback
   ```

6. Copia el Client ID y Client Secret de Google en **Supabase → Authentication → Providers → Google** y activa el proveedor.
7. En **Supabase → Authentication → URL Configuration** configura:

   ```text
   Site URL: https://TU_PROYECTO.vercel.app
   Redirect URL: https://TU_PROYECTO.vercel.app/**
   ```

8. En `app.js`, cambia:

   ```js
   const GOOGLE_REDIRECT = 'https://TU_PROYECTO.vercel.app';
   ```

Para previews de Vercel puedes añadir sus URLs como Redirect URLs adicionales. No uses un comodín más amplio de lo necesario en producción.

### 6. Preparar Drime

Consigue en tu cuenta de Drime:

- `DRIME_ACCESS_TOKEN`: token privado de acceso.
- `DRIME_WORKSPACE_ID`: identificador numérico del workspace.

No escribas el token en `app.js`, `README.md`, un commit, una captura o un mensaje público. El token solo debe existir como variable privada del servidor.

### 7. Publicar el repositorio en Vercel

1. En Vercel pulsa **Add New → Project**.
2. Importa el repositorio de GitHub.
3. Deja la raíz del proyecto en `.`.
4. No hace falta un comando de compilación: la web es estática y Vercel detecta las funciones de `api/`.
5. En **Settings → Environment Variables** añade para Production y Preview:

   | Variable | Valor |
   |---|---|
   | `DRIME_ACCESS_TOKEN` | Token privado de Drime |
   | `DRIME_WORKSPACE_ID` | ID numérico del workspace |
   | `SUPABASE_URL` | URL del proyecto de Supabase |
   | `SUPABASE_PUBLISHABLE_KEY` | Clave pública `sb_publishable_...` |

6. Pulsa **Deploy** y guarda la URL final.

Con la integración Git activada, cada push a `main` crea un despliegue de producción y las ramas o pull requests pueden generar previews.

También se puede publicar manualmente desde la raíz:

```bash
npx vercel
npx vercel --prod
```

### 8. Desplegar la Edge Function de subida

La función está en `supabase/functions/drime-upload/index.ts`. Valida la sesión y actúa como proxy entre el navegador y las funciones privadas de Vercel.

Instala o ejecuta la CLI de Supabase y enlaza tu proyecto:

```bash
npx supabase login
npx supabase link --project-ref TU_PROJECT_REF
```

Configura sus variables. Sustituye los valores de ejemplo:

```bash
npx supabase secrets set VERCEL_SITE_URL=https://TU_PROYECTO.vercel.app
npx supabase secrets set SUPABASE_PUBLISHABLE_KEY=sb_publishable_TU_CLAVE_PUBLICA
npx supabase secrets set ALLOWED_ORIGINS=https://TU_PROYECTO.vercel.app
```

Despliega:

```bash
npx supabase functions deploy drime-upload --no-verify-jwt
```

`verify_jwt` está desactivado en la puerta de entrada porque las claves publishable modernas no son JWT. La propia función verifica el token de sesión del usuario mediante `/auth/v1/user` antes de realizar cualquier operación.

### 9. Repetir las URLs definitivas

Cuando conozcas la URL final de Vercel, confirma que sea la misma en estos lugares:

- `GOOGLE_REDIRECT` de `app.js`.
- Site URL y Redirect URLs de Supabase Auth.
- Authorized JavaScript origins de Google.
- `VERCEL_SITE_URL` y `ALLOWED_ORIGINS` de la Edge Function.

El callback de Google siempre apunta a Supabase, no directamente a Vercel.

## Primera prueba

Haz esta comprobación en dos navegadores o equipos:

1. Crea o abre exactamente dos cuentas.
2. Inicia sesión con ambas.
3. Comprueba que cada una muestra a la otra y su estado conectado.
4. Envía una nota y confirma que aparece al otro usuario sin pulsar F5.
5. Envía una imagen pequeña y revisa la previsualización.
6. Envía un archivo de más de 5 MB para probar la subida por bloques.
7. Descárgalo desde la otra cuenta y comprueba el estado **Descargado**.
8. Márcalo como favorito y envíalo a la papelera; estos estados deben ser individuales.
9. Desde la cuenta remitente, usa **Eliminar definitivamente** y comprueba que desaparece para ambos y de Drime.
10. Cambia la foto de perfil con un PNG, JPG o WebP menor de 2 MB.

## Comprobaciones técnicas

- Abrir `/api/status`: debe indicar si Drime está configurado sin revelar el token.
- Abrir `/api/drime/health` sin sesión: debe responder `Sesión requerida`.
- Con sesión, la barra de espacio debe mostrar los datos de Drime.
- En Supabase, `profiles` debe contener dos filas y `items` solo los envíos realizados.
- En Vercel, el último deployment debe aparecer como **Ready**.

## Problemas frecuentes

### Aparece `[object Object]`

Actualiza a la versión actual de `app.js` y `api/drime.js`. Ambas convierten los errores recibidos como objetos en mensajes legibles. Después haz un redeploy y recarga con Ctrl+F5.

### `Sesión requerida` o `Sesión caducada`

Cierra la sesión, vuelve a entrar y repite la operación. La API rechaza a propósito cualquier petición sin un token de usuario válido.

### Google vuelve a una dirección incorrecta

Compara las cuatro ubicaciones de la sección **Repetir las URLs definitivas**. Un carácter, protocolo o subdominio diferente es suficiente para bloquear la redirección.

### Un usuario no encuentra al otro

Revisa que existan dos filas en `profiles`. Si una cuenta se creó antes de instalar el disparador, crea manualmente su perfil o elimina y vuelve a crear esa cuenta de prueba.

### La foto de perfil devuelve un error RLS

Comprueba que el bucket se llame exactamente `avatars`, sea privado y tenga las cuatro políticas incluidas en `supabase/schema.sql`. El reemplazo de una foto usa `upsert`, por lo que necesita permisos de lectura, inserción y actualización.

### La subida pequeña funciona pero la grande no

Confirma que `drime-upload` está desplegada, que Vercel tiene las variables de Drime y que la Edge Function apunta a la URL correcta de Vercel. Los archivos de 5 MB o más usan subida multipart.

## Guardar cambios en GitHub

Después de modificar el proyecto:

```bash
git pull
git add .
git commit -m "Describe brevemente el cambio"
git push
```

Antes de cada push ejecuta al menos:

```bash
node --check app.js
node --check api/drime.js
```

Revisa también `git status` y confirma que no aparezcan `.env`, `.vercel`, tokens, contraseñas ni ZIP con datos privados.

## Copias de seguridad

GitHub conserva el código y su historial, pero no guarda por seguridad:

- Los secretos de Vercel.
- El token o workspace de Drime.
- La configuración privada de Google OAuth.
- Los usuarios y datos de Supabase.
- Los archivos almacenados en Drime.

Para reconstruir el sistema necesitas este repositorio y volver a configurar esas credenciales en sus paneles correspondientes. Guarda los códigos de recuperación y secretos en un gestor de contraseñas, nunca dentro del repositorio.

## Seguridad

- Mantén activado RLS en todas las tablas públicas.
- Usa una clave publishable en el frontend; nunca una secret key.
- Rota inmediatamente cualquier token privado que se publique por error.
- Mantén Drime detrás de `api/drime.js`; el navegador no debe conocer su token.
- Revisa quién tiene acceso al repositorio privado y elimina colaboradores que ya no lo necesiten.
- No guardes datos personales innecesarios en nombres de archivo, mensajes o commits.

## Licencia

No se ha añadido una licencia pública. En ausencia de licencia, el código sigue teniendo todos los derechos reservados por su autor. Añade una licencia solo si decides permitir que otras personas lo reutilicen o distribuyan.

