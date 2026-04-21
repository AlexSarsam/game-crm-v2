# Games CRM

Plataforma de juegos hecha con Laravel 12. Por fuera es una web donde los jugadores acceden a juegos, juegan, guardan sus resultados y hablan por chat en tiempo real. Por dentro funciona como un CRM que gestiona usuarios, roles, juegos, sesiones, emociones y verificación facial.

Es el proyecto final del módulo **0613 – Desarrollo Web en Entorno Servidor**.

## Qué hace la aplicación

- Los usuarios se registran e inician sesión con contraseña.
- Antes de jugar, cada jugador registra una foto suya y la app verifica su cara con la webcam.
- Mientras juega, la cámara detecta sus emociones (contento, triste, enfadado...) y las guarda.
- Los jugadores del mismo juego pueden chatear entre ellos en tiempo real.
- Los administradores y gestores crean, editan y publican juegos desde un panel.

## Stack técnico

| Tecnología | Para qué sirve |
|---|---|
| Laravel 12 + PHP 8.2 | Backend, API REST, autenticación, permisos |
| Inertia.js + React | Interfaz del CRM sin SPA aparte |
| PostgreSQL 16 | Base de datos relacional |
| Laravel Sanctum | Protección de la API con cookies |
| Laravel Reverb | Servidor WebSocket oficial de Laravel |
| Laravel Echo + pusher-js | Cliente WebSocket del navegador |
| Python + Flask + DeepFace | Microservicio de reconocimiento facial |
| face-api.js | Detección de emociones en el navegador |
| Docker Compose | Aísla la base de datos y el microservicio Python |
| Three.js | Motor del juego cliente (Runner 3D) |

## Arquitectura

```text
                     +----------------------+
                     |       Navegador      |
                     |----------------------|
                     |  Inertia + React     |
                     |  Runner 3D (iframe)  |
                     |  face-api.js         |
                     +----------+-----------+
                                |
                  HTTP / cookies | WebSocket privado
                                |
                                v
+-----------------------------------------------------------+
|                        Laravel 12                         |
|-----------------------------------------------------------|
|  Auth + sesiones | Roles + permisos | Rutas web + API     |
|  CRUD de juegos  | Verificación facial | Broadcasting     |
+------------------------+-----------------+----------------+
                         |                 |
                    SQL  |                 | HTTP interno
                         v                 v
                 +---------------+    +----------------------+
                 | PostgreSQL 16 |    | face-service (Python)|
                 |---------------|    |----------------------|
                 | users         |    | Flask + DeepFace     |
                 | roles         |    | /health              |
                 | games         |    | /compare             |
                 | game_sessions |    +----------------------+
                 | emotion_events|
                 | chat_messages |
                 +---------------+
```

## Roles

| Rol | Puede hacer |
|---|---|
| `admin` | Gestionar usuarios, cambiar roles y también los juegos |
| `gestor` | Crear, editar, publicar y despublicar juegos |
| `jugador` | Jugar, registrar su cara, verificarse, chatear y ver sus resultados |

Los permisos se validan siempre en el backend. Aunque un usuario conozca una URL, si no tiene el rol correcto no entra.

## Principios que sigue el proyecto

1. **Laravel es la única autoridad de seguridad.** El microservicio Python no abre sesiones ni decide nada.
2. **El navegador nunca habla directamente con Python.** Siempre pasa por Laravel.
3. **Las emociones se procesan en el navegador.** Al servidor solo llegan datos abstractos (`happy`, `0.93`, `timestamp`). No se envían imágenes ni vídeo.
4. **Web, API y tiempo real están separados** en `web.php`, `api.php` y `channels.php`.
5. **El chat es por juego, no global.** Cada juego tiene su propio canal privado.

## Flujos principales

### Enrolamiento facial

1. El usuario autenticado entra en `/face/enroll`.
2. La cámara captura una foto.
3. Laravel la guarda y la asocia al usuario.

Python no interviene en este paso.

### Verificación facial

1. El usuario abre `/face/verify`.
2. La webcam captura una imagen actual.
3. Laravel manda la foto registrada + la actual al microservicio Python.
4. Python las compara con DeepFace y devuelve solo datos técnicos.
5. **Laravel decide** si la verificación es válida.
6. Si lo es, marca la sesión como verificada durante un tiempo limitado.

### Partida de un jugador

1. El jugador entra en `/play/{game}`.
2. El middleware `face.verified` bloquea la ruta si ya no es válida.
3. El frontend llama a `POST /api/games/{game}/sessions` y recibe un `session_id`.
4. Durante la partida, face-api.js detecta emociones cada pocos segundos y las manda a la API.
5. Al terminar, el jugador introduce su puntuación y se cierra la sesión con `PATCH`.

### Chat en tiempo real

1. Al abrir el juego, el frontend se conecta al canal privado `game.{id}` con Echo.
2. Laravel autoriza el canal en `routes/channels.php`.
3. Cuando alguien envía un mensaje, se guarda en `chat_messages` y se dispara el evento `MessageSent`.
4. Reverb lo reenvía a todos los conectados al mismo juego.
5. El chat aparece en pantalla sin recargar nada.

## API

### Pública

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/games` | Lista los juegos publicados |

### Protegida (auth:sanctum)

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/games/{game}/sessions` | Inicia una sesión de juego |
| `PATCH` | `/api/games/{game}/sessions/{session}` | Guarda puntuación y cierra la sesión |
| `POST` | `/api/games/{game}/sessions/{session}/emotions` | Registra una emoción detectada |
| `GET` | `/api/games/{game}/messages` | Historial del chat del juego |
| `POST` | `/api/games/{game}/messages` | Envía un mensaje al chat |

## Base de datos

| Tabla | Qué guarda |
|---|---|
| `roles` | Catálogo de roles |
| `users` | Usuarios del sistema (incluye `role_id` y `face_image_path`) |
| `games` | Juegos del CRM con estado publicado/no publicado |
| `game_sessions` | Partidas iniciadas por jugadores |
| `emotion_events` | Emociones detectadas durante cada sesión |
| `chat_messages` | Mensajes del chat por juego y autor |

## Microservicio facial (Python)

Vive en `face-service/` y su única responsabilidad es comparar dos imágenes.

| Método | Ruta | Para qué |
|---|---|---|
| `GET` | `/health` | Comprobar que está vivo |
| `POST` | `/compare` | Comparar dos imágenes en base64 |

No sabe nada de usuarios, sesiones ni permisos. Solo compara rostros y devuelve resultados.

## Cómo arrancarlo en local

### Requisitos

- PHP 8.2+
- Composer
- Node.js
- Docker Desktop

### Primera vez

```bash
composer install
npm install
cp .env.example .env
php artisan key:generate
docker compose up -d
php artisan migrate --seed
```

### Arrancar el proyecto

```bash
composer dev
```

Esto levanta a la vez:

- Laravel (`http://localhost:8000`)
- Reverb (`ws://localhost:8080`)
- Vite (hot reload de React)
- Cola de trabajos
- Pail (logs en vivo)

Docker debe estar corriendo antes (PostgreSQL y `face-service`).

### Servicios esperados

| Servicio | URL |
|---|---|
| Laravel | `http://localhost:8000` |
| Reverb | `ws://localhost:8080` |
| PostgreSQL | `localhost:5433` |
| face-service | `http://localhost:5001` |

Para comprobar que Python funciona:

```bash
curl http://localhost:5001/health
```

## Usuarios de prueba

Todos tienen contraseña `password`.

| Email | Rol |
|---|---|
| `admin@example.com` | admin |
| `gestor@example.com` | gestor |
| `jugador@example.com` | jugador |

## Despliegue

Cada pieza se despliega según su naturaleza:

- **Laravel** → servidor Linux con PHP, Nginx/Apache y PostgreSQL.
- **Microservicio Python** → contenedor Docker, idealmente en red interna.
- **Juegos cliente** → pueden servirse como estáticos en Vercel, Netlify o Cloudflare. Laravel solo guarda la URL.

Esta separación es parte del diseño y del criterio RA7.

## Variables de entorno importantes

| Variable | Valor típico |
|---|---|
| `DB_CONNECTION` | `pgsql` |
| `DB_PORT` | `5433` |
| `FACE_SERVICE_URL` | `http://localhost:5001` |
| `FACE_VERIFICATION_TTL` | `30` |
| `BROADCAST_CONNECTION` | `reverb` |
| `QUEUE_CONNECTION` | `database` |

## Decisiones de diseño

- La verificación facial **refuerza** el login, no lo reemplaza.
- Laravel **guarda** la imagen pero no la analiza.
- Python **compara** pero no decide.
- Las emociones se guardan por sesión, no como perfil biométrico.
- El chat es contextual por juego y usa canal privado.
- Los juegos son clientes externos de la API, como podría serlo una app móvil.

## Relación con RA6 y RA7

**RA6** — servicios web reutilizables:
- diseño claro de la API
- separación real entre `web.php` y `api.php`
- consumo desde clientes distintos
- integración de un servicio externo (Python)
- validación y seguridad centralizadas

**RA7** — publicación y consumo en entorno real:
- Laravel preparado para desplegarse fuera de local
- juegos servibles como estáticos
- microservicio facial ya en Docker
- la API se consume tanto desde el navegador como desde juegos cliente
