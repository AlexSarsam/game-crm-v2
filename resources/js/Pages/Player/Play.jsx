import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { Head, Link } from '@inertiajs/react';
import { useEffect, useRef, useState } from 'react';

const EMOTION_INTERVAL_MS = 3000;

export default function PlayerPlay({ game }) {
    const [sessionId, setSessionId] = useState(null);
    const [score, setScore] = useState('');
    const [ended, setEnded] = useState(false);
    const [error, setError] = useState(null);
    const [currentEmotion, setCurrentEmotion] = useState(null);
    const [modelsLoaded, setModelsLoaded] = useState(false);
    const [messages, setMessages] = useState([]);
    const [chatInput, setChatInput] = useState('');

    const chatEndRef = useRef(null);
    const startedRef = useRef(false);
    const videoRef = useRef(null);
    const sessionIdRef = useRef(null);
    const emotionIntervalRef = useRef(null);
    const iframeRef = useRef(null);
    const faceApiRef = useRef(null);

    useEffect(() => {
        sessionIdRef.current = sessionId;
    }, [sessionId]);

    useEffect(() => {
        function onMessage(event) {
            if (iframeRef.current?.contentWindow !== event.source) {
                return;
            }

            if (event.data?.type === 'gameOver') {
                setScore(String(event.data.score));
            }
        }

        window.addEventListener('message', onMessage);

        return () => window.removeEventListener('message', onMessage);
    }, []);

    useEffect(() => {
        import('face-api.js')
            .then((faceapi) => {
                faceApiRef.current = faceapi;

                return Promise.all([
                    faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
                    faceapi.nets.faceExpressionNet.loadFromUri('/models'),
                ]);
            })
            .then(() => setModelsLoaded(true))
            .catch(() => setError('No se pudieron cargar los modelos de deteccion de emociones.'));
    }, []);

    useEffect(() => {
        if (startedRef.current) {
            return;
        }

        startedRef.current = true;

        requestJson(`/api/games/${game.id}/sessions`, {
            method: 'POST',
        })
            .then((data) => setSessionId(data.session_id))
            .catch((requestError) => {
                setError(requestError.message ?? 'No se pudo iniciar la sesion.');
            });
    }, [game.id]);

    useEffect(() => {
        if (!modelsLoaded || ended) {
            return;
        }

        let cameraStream = null;

        navigator.mediaDevices
            .getUserMedia({ video: { width: 320, height: 240 } })
            .then((stream) => {
                cameraStream = stream;

                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    videoRef.current.play();
                }
            })
            .catch(() => {
                setError('No se pudo acceder a la camara. El juego seguira funcionando, pero no se registraran emociones.');
            });

        emotionIntervalRef.current = setInterval(async () => {
            if (!videoRef.current || !sessionIdRef.current) {
                return;
            }

            try {
                const faceapi = faceApiRef.current;

                if (!faceapi) {
                    return;
                }

                const detection = await faceapi
                    .detectSingleFace(
                        videoRef.current,
                        new faceapi.TinyFaceDetectorOptions(),
                    )
                    .withFaceExpressions();

                if (!detection) {
                    return;
                }

                const [emotion, confidence] = topEmotion(detection.expressions);
                setCurrentEmotion(emotion);

                await requestJson(
                    `/api/games/${game.id}/sessions/${sessionIdRef.current}/emotions`,
                    {
                        method: 'POST',
                        body: JSON.stringify({
                            emotion,
                            confidence,
                            detected_at: new Date().toISOString(),
                        }),
                    },
                );
            } catch {}
        }, EMOTION_INTERVAL_MS);

        return () => {
            clearInterval(emotionIntervalRef.current);
            cameraStream?.getTracks().forEach((track) => track.stop());
        };
    }, [modelsLoaded, ended, game.id]);

    useEffect(() => {
        requestJson(`/api/games/${game.id}/messages`)
            .then(setMessages)
            .catch(() => {
                setError('No se pudo cargar el historial del chat.');
            });

        const channel = window.Echo.private(`game.${game.id}`);
        channel.listen('MessageSent', (message) => {
            setMessages((previous) => [...previous, message]);
        });

        return () => window.Echo.leave(`game.${game.id}`);
    }, [game.id]);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    async function sendMessage(event) {
        event.preventDefault();

        if (!chatInput.trim()) {
            return;
        }

        try {
            await requestJson(`/api/games/${game.id}/messages`, {
                method: 'POST',
                body: JSON.stringify({ body: chatInput }),
            });
            setChatInput('');
        } catch (requestError) {
            setError(requestError.message ?? 'No se pudo enviar el mensaje.');
        }
    }

    async function handleEndSession(event) {
        event.preventDefault();

        if (!sessionId) {
            return;
        }

        clearInterval(emotionIntervalRef.current);

        try {
            await requestJson(`/api/games/${game.id}/sessions/${sessionId}`, {
                method: 'PATCH',
                body: JSON.stringify({ score: parseInt(score, 10) }),
            });

            setEnded(true);
        } catch (requestError) {
            setError(requestError.message ?? 'No se pudo guardar la puntuacion.');
        }
    }

    return (
        <AuthenticatedLayout
            header={
                <div className="flex items-center gap-4">
                    <Link
                        href={route('play.index')}
                        className="text-sm text-indigo-600 hover:underline"
                    >
                        Volver
                    </Link>
                    <h2 className="text-xl font-semibold leading-tight text-gray-800">
                        {game.title}
                    </h2>
                    {currentEmotion && (
                        <span className="rounded-full bg-indigo-100 px-3 py-1 text-sm text-indigo-700 capitalize">
                            {emotionEmoji(currentEmotion)} {currentEmotion}
                        </span>
                    )}
                </div>
            }
        >
            <Head title={game.title} />
            <video
                ref={videoRef}
                className="fixed bottom-4 right-4 z-50 h-36 w-48 rounded-lg border-2 border-indigo-500 shadow-lg"
                muted
                playsInline
            />
            {currentEmotion && (
                <div className="fixed bottom-44 right-4 z-50 rounded-full bg-white px-3 py-1 text-2xl shadow-lg">
                    {emotionEmoji(currentEmotion)}
                </div>
            )}

            <div className="p-4">
                <div className="flex gap-4">
                    <div className="flex flex-1 flex-col gap-4">
                        {error && (
                            <p className="text-sm text-red-600">{error}</p>
                        )}

                        <div
                            onClick={() => iframeRef.current?.focus()}
                            className="cursor-pointer"
                        >
                            <iframe
                                ref={iframeRef}
                                src={game.url}
                                title={game.title}
                                className="h-[600px] w-full rounded-lg border shadow"
                                allowFullScreen
                                onLoad={() => iframeRef.current?.focus()}
                            />
                        </div>

                        {!ended ? (
                            <form
                                onSubmit={handleEndSession}
                                className="flex items-center gap-4"
                            >
                                <input
                                    type="number"
                                    min="0"
                                    value={score}
                                    onChange={(event) =>
                                        setScore(event.target.value)
                                    }
                                    placeholder="Tu puntuacion"
                                    required
                                    className="rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                                />
                                <button
                                    type="submit"
                                    disabled={!sessionId}
                                    className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                                >
                                    Terminar partida
                                </button>
                            </form>
                        ) : (
                            <div className="text-center">
                                <p className="text-lg font-semibold text-green-700">
                                    Partida guardada. Puntuacion: {score}
                                </p>
                                <Link
                                    href={route('play.index')}
                                    className="mt-2 inline-block text-indigo-600 hover:underline"
                                >
                                    Volver a los juegos
                                </Link>
                            </div>
                        )}
                    </div>

                    <div className="flex w-80 flex-col rounded-lg border bg-white shadow">
                        <div className="border-b px-4 py-3">
                            <h3 className="font-semibold text-gray-800">
                                Chat del juego
                            </h3>
                        </div>
                        <div
                            className="flex-1 space-y-2 overflow-y-auto p-4"
                            style={{ maxHeight: '520px' }}
                        >
                            {messages.map((message) => (
                                <div key={message.id} className="text-sm">
                                    <span className="font-semibold text-indigo-600">
                                        {message.user?.name}:
                                    </span>{' '}
                                    <span className="text-gray-700">
                                        {message.body}
                                    </span>
                                </div>
                            ))}
                            <div ref={chatEndRef} />
                        </div>
                        <form
                            onSubmit={sendMessage}
                            className="flex gap-2 border-t p-3"
                        >
                            <input
                                type="text"
                                value={chatInput}
                                onChange={(event) =>
                                    setChatInput(event.target.value)
                                }
                                placeholder="Escribe un mensaje..."
                                className="flex-1 rounded-md border-gray-300 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                            />
                            <button
                                type="submit"
                                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700"
                            >
                                Enviar
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        </AuthenticatedLayout>
    );
}

async function requestJson(url, options = {}) {
    const method = options.method ?? 'GET';
    const needsCsrf = !['GET', 'HEAD'].includes(method.toUpperCase());
    const headers = {
        Accept: 'application/json',
        ...(needsCsrf
            ? {
                  'X-XSRF-TOKEN': getCookie('XSRF-TOKEN'),
              }
            : {}),
        ...(options.body
            ? {
                  'Content-Type': 'application/json',
              }
            : {}),
        ...(options.headers ?? {}),
    };

    const response = await fetch(url, {
        credentials: 'same-origin',
        ...options,
        method,
        headers,
    });

    const contentType = response.headers.get('content-type') ?? '';
    const data = contentType.includes('application/json')
        ? await response.json()
        : null;

    if (!response.ok) {
        throw new Error(
            data?.message ?? data?.error ?? 'La peticion no se pudo completar.',
        );
    }

    return data;
}

function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);

    if (parts.length === 2) {
        return decodeURIComponent(parts.pop().split(';').shift());
    }

    return '';
}

function topEmotion(expressions) {
    return Object.entries(expressions).sort((a, b) => b[1] - a[1])[0];
}

function emotionEmoji(emotion) {
    const emojis = {
        happy: '😊',
        sad: '😢',
        angry: '😠',
        surprised: '😲',
        neutral: '😐',
        disgusted: '🤢',
        fearful: '😨',
    };

    return emojis[emotion] ?? '🙂';
}
