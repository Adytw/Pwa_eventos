# EventPass PWA

**EventPass** es una aplicación web progresiva para administrar eventos, registrar participantes, emitir boletos con QR y registrar asistencias. Está construida con Ionic + Angular + TypeScript y utiliza IndexedDB (mediante Dexie) para conservar la información en el dispositivo.

> **Alcance de esta entrega:** el modo demostración funciona localmente y permite probar la interfaz, altas de eventos, inscripciones, generación de QR, lectura por cámara, control de duplicados, almacenamiento offline, exportación CSV, instalación PWA y notificaciones de prueba. La conexión opcional a Supabase está preparada para autenticación y sincronización de asistencias, pero requiere crear un proyecto Supabase, ejecutar el SQL y configurar credenciales. No se ha creado una cuenta de nube ni se ha publicado la aplicación en nombre del usuario.

## 1. Requisitos de instalación

- Windows 10/11.
- Node.js 20.19 o superior; recomendado Node 24 LTS compatible con Angular 21.
- npm 10 o superior.
- Visual Studio Code.
- Google Chrome o Microsoft Edge actualizado.

Comprueba las versiones en una terminal:

```bash
node -v
npm -v
```

Este proyecto utiliza Angular 21.2.26, Ionic Angular 9.0.13 y TypeScript 5.9.3. Angular 21 admite Node `^20.19.0`, `^22.12.0` o `^24.0.0`; Ionic Angular 9 admite Angular 18 a 22. Consulta las tablas oficiales de compatibilidad antes de actualizar dependencias:

- https://angular.dev/reference/versions
- https://ionicframework.com/docs/reference/support

## 2. Instalar y ejecutar en Windows

1. Descarga y descomprime `EventPass_PWA.zip`.
2. Abre Visual Studio Code.
3. Selecciona **Archivo > Abrir carpeta** y abre la carpeta `EventPass_PWA` (la que contiene `package.json`).
4. Abre una terminal en VS Code con **Terminal > Nueva terminal**.
5. Ejecuta:

```bash
npm install
```

6. Cuando termine la instalación, ejecuta:

```bash
npm start
```

7. Abre en Chrome:

```text
http://localhost:4200
```

No abras `index.html` directamente desde el Explorador de Windows. La aplicación debe ejecutarse mediante el servidor de desarrollo.

## 3. Recorrido rápido de demostración

La primera vez, EventPass carga datos de ejemplo en IndexedDB. Son datos ficticios y permanecen en el navegador.

1. En **Resumen**, revisa los indicadores y próximos eventos.
2. En **Eventos**, crea un evento con nombre, categoría, fecha, lugar y capacidad.
3. En **Inscripciones**, elige un evento publicado, registra un nombre y un correo de prueba.
4. En **Boletos QR**, pulsa **Ver QR** para mostrar el código o descargarlo como PNG.
5. En **Escáner de acceso**, activa la cámara y muestra el QR en otra pantalla; alternativamente, copia el código `EP-...` del boleto y pégalo en el campo manual.
6. Escanea o valida el mismo boleto por segunda vez: EventPass debe advertir que ya fue utilizado.
7. En **Asistencias**, verifica el registro y descarga el CSV.
8. En **Configuración**, puedes solicitar permiso de notificaciones y probar el estado de instalación.

Para probar el escáner, la cámara necesita permiso del navegador. En desarrollo, `localhost` se considera un contexto seguro. En un despliegue, la cámara, geolocalización y otras APIs requieren HTTPS.

## 4. Probar la PWA y el Service Worker

El servidor `ng serve` está pensado para desarrollo y no registra el Service Worker porque Angular lo desactiva en modo desarrollo. Para comprobar el comportamiento PWA:

```bash
npm run build:prod
npm run preview
```

Después abre:

```text
http://localhost:8080
```

En Chrome/Edge:

1. Abre DevTools con `F12`.
2. Entra a **Application > Manifest** y comprueba nombre, iconos y modo de visualización.
3. En **Application > Service Workers**, confirma que `ngsw-worker.js` esté registrado y activo.
4. En **Application > Storage > IndexedDB**, abre `EventPassDB`.
5. En **Network**, activa **Offline** y recarga la aplicación después de que haya cargado una vez con conexión.
6. Comprueba que la interfaz se abre y que los datos locales continúan disponibles.

La PWA se instala desde el icono de instalación de Chrome/Edge cuando el navegador lo ofrece. En iPhone/iPad, utiliza **Compartir > Agregar a pantalla de inicio** desde Safari.

## 5. ¿Cómo funciona el modo offline?

- Angular Service Worker precarga el App Shell, scripts, estilos, manifiesto e iconos.
- Los recursos estáticos principales usan `prefetch`; los recursos secundarios se cargan bajo demanda; las fuentes web públicas usan caché dinámica con estrategia `performance` y vencimiento de 30 días.
- Dexie almacena eventos, inscripciones, boletos, asistencias y una cola de sincronización en IndexedDB.
- Cuando se escanea un boleto disponible localmente, el acceso se registra en IndexedDB y queda con estado **Pendiente**.
- Cuando vuelve Internet, el usuario puede pulsar **Sincronizar**. Para sincronizar con un servidor real se necesita configurar Supabase y tener los eventos/boletos correspondientes creados en la base de datos central.
- Si no hay Supabase configurado o no hay sesión autorizada, las asistencias se conservan localmente y no se marcan falsamente como sincronizadas.

**Límite importante de la validación offline:** un dispositivo sin conexión no puede conocer los accesos que otro dispositivo independiente registró en ese mismo momento. La detección definitiva de duplicados entre varios dispositivos requiere sincronización con el servidor. Para una operación offline real, cada lector debe precargar los boletos autorizados y el servidor debe resolver conflictos al sincronizar.

## 6. Conectar Supabase (opcional)

1. Crea un proyecto en https://supabase.com/.
2. En el panel de Supabase abre **SQL Editor**.
3. Ejecuta el contenido de `supabase/schema.sql`.
4. En **Project Settings > API**, copia la Project URL y la clave `anon`/publishable.
5. Abre `src/environments/environment.ts` y sustituye los valores vacíos:

```ts
export const environment = {
  production: false,
  supabaseUrl: 'https://TU-PROYECTO.supabase.co',
  supabaseAnonKey: 'TU_CLAVE_ANON_PUBLICA'
};
```

6. Crea un usuario en **Authentication > Users** y asigna su perfil/rol autorizado siguiendo el SQL.
7. Reinicia `npm start`.
8. En EventPass abre **Configuración**, inicia sesión con el usuario de Supabase y pulsa **Sincronizar asistencias pendientes**.

Nunca incluyas la clave `service_role` en una aplicación web. La clave pública `anon`/publishable puede utilizarse en el cliente porque la seguridad se aplica con autenticación y políticas RLS.

La integración de nube incluida en esta entrega sincroniza los registros de asistencia. Para una operación multiusuario completa de producción, también se debe conectar la creación/actualización de eventos, inscripciones y emisión de boletos al backend y generar las firmas de QR en una función segura del servidor.

## 7. Publicar en Netlify

1. Genera la compilación:

```bash
npm run build:prod
```

2. La carpeta publicable es:

```text
dist/eventpass/browser
```

3. En Netlify selecciona **Add new site > Deploy manually** y arrastra el contenido de `dist/eventpass/browser`.
4. Netlify asigna un dominio HTTPS. Comprueba que abra con `https://`.
5. Para despliegues continuos, sube el proyecto a GitHub y conecta el repositorio con Netlify. Configura:
   - Build command: `npm run build:prod`
   - Publish directory: `dist/eventpass/browser`

No es posible publicar en una cuenta personal desde este paquete sin que el propietario inicie sesión y autorice el despliegue.

## 8. Git y commits recomendados

Desde la carpeta del proyecto:

```bash
git init
git add .
git commit -m "chore: crear estructura inicial de EventPass"
git branch -M main
git checkout -b develop
```

Después realiza commits pequeños por funcionalidad, por ejemplo:

```bash
git add .
git commit -m "feat: agregar gestión de eventos"
git commit -am "feat: implementar inscripciones y boletos QR"
git commit -am "feat: integrar escáner y control de asistencia"
git commit -am "feat: configurar PWA y almacenamiento offline"
```

Crea el repositorio vacío en GitHub y conecta la URL que GitHub te proporcione:

```bash
git remote add origin https://github.com/TU-USUARIO/EventPass.git
git push -u origin main
git push -u origin develop
```

## 9. Estructura del proyecto

```text
EventPass_PWA/
├── public/
│   ├── icons/
│   └── manifest.webmanifest
├── src/
│   ├── app/
│   │   ├── core/
│   │   │   ├── cloud.service.ts
│   │   │   ├── eventpass-db.ts
│   │   │   └── models.ts
│   │   ├── app.component.html
│   │   ├── app.component.scss
│   │   ├── app.component.ts
│   │   └── app.config.ts
│   ├── environments/
│   ├── index.html
│   ├── main.ts
│   └── styles.scss
├── supabase/schema.sql
├── angular.json
├── ngsw-config.json
├── package.json
└── README.md
```

## 10. Limitaciones y siguientes tareas antes de llamarlo producción

- El selector de roles y los datos de demostración son locales; no constituyen autenticación ni autorización segura.
- La validación QR local comprueba que el código exista en los boletos guardados en el dispositivo y evita su reutilización local. Para producción, las firmas del boleto deben generarse/verificarse con claves administradas en backend y la validación central debe ser transaccional.
- La sincronización multi-dispositivo requiere que el catálogo de eventos y boletos esté centralizado en Supabase y que cada dispositivo precargue los datos que validará offline.
- El sistema de notificaciones implementa permiso y notificación de prueba; el envío push remoto requiere Web Push, sus claves VAPID y una función backend.
- Antes de un uso con datos personales reales, deben añadirse aviso de privacidad, políticas de retención, controles de acceso revisados y pruebas de seguridad.

La entrega es una base funcional para ejecutar, probar y ampliar el proyecto escolar, no una certificación de seguridad ni un servicio ya desplegado en producción.
