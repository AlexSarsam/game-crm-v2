<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Game;
use App\Models\GameSession;
use App\Support\GameplayAccess;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class GameSessionController extends Controller
{
    public function store(Request $request, Game $game): JsonResponse
    {
        abort_unless(GameplayAccess::canPlay($request, $game), 403, 'Necesitas verificar tu identidad antes de empezar una partida.');

        $session = GameSession::create([
            'user_id' => $request->user()->id,
            'game_id' => $game->id,
            'started_at' => now(),
        ]);

        $this->publishEvent('game.session.started', [
            'session_id' => $session->id,
            'game_id'    => $game->id,
            'user_id'    => $request->user()->id,
            'started_at' => $session->started_at->toISOString(),
        ]);

        return response()->json([
            'session_id' => $session->id,
            'started_at' => $session->started_at,
        ], 201);
    }

    public function update(Request $request, Game $game, GameSession $session): JsonResponse
    {
        abort_unless(
            $game->is_published && $session->game_id === $game->id && $session->user_id === $request->user()->id,
            403
        );

        $validated = $request->validate([
            'score' => 'required|integer|min:0',
        ]);

        $session->update([
            'ended_at' => now(),
            'score'    => $validated['score'],
        ]);

        $this->publishEvent('game.session.ended', [
            'session_id' => $session->id,
            'game_id'    => $game->id,
            'user_id'    => $session->user_id,
            'score'      => $validated['score'],
            'ended_at'   => now()->toISOString(),
        ]);

        return response()->json($session->fresh());
    }

    private function publishEvent(string $routingKey, array $payload): void
    {
        try {
            $connection = new \PhpAmqpLib\Connection\AMQPStreamConnection(
                config('queue.connections.rabbitmq.hosts.0.host', '127.0.0.1'),
                config('queue.connections.rabbitmq.hosts.0.port', 5672),
                config('queue.connections.rabbitmq.hosts.0.user', 'guest'),
                config('queue.connections.rabbitmq.hosts.0.password', 'guest'),
                config('queue.connections.rabbitmq.hosts.0.vhost', '/'),
            );

            $channel = $connection->channel();

            $channel->exchange_declare('game_events', 'topic', false, true, false);

            $msg = new \PhpAmqpLib\Message\AMQPMessage(
                json_encode($payload),
                ['content_type' => 'application/json', 'delivery_mode' => 2]
            );

            $channel->basic_publish($msg, 'game_events', $routingKey);
            $channel->close();
            $connection->close();
        } catch (\Exception $e) {
            Log::error('RabbitMQ publish failed: ' . $e->getMessage());
        }
    }
}
