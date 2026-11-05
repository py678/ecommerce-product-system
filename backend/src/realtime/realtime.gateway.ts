import { UnauthorizedException } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { AccessTokenService } from '../auth/access-token.service.js';
import { RealtimeService } from './realtime.service.js';
function originAllowed(origin: string | undefined) {
  return (
    !origin ||
    origin === (process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173')
  );
}
@WebSocketGateway({
  path: '/socket.io/',
  maxHttpBufferSize: 16 * 1024,
  connectTimeout: 5000,
  cors: { origin: (origin, callback) => callback(null, originAllowed(origin)) },
  allowRequest: (request, callback) =>
    callback(null, originAllowed(request.headers.origin)),
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  constructor(
    private readonly tokens: AccessTokenService,
    private readonly realtime: RealtimeService,
  ) {}
  afterInit(server: Server) {
    server.use((socket, next) => {
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        next(this.authError('AUTH_UNAVAILABLE'));
      }, 5000);
      timer.unref();
      const token: unknown = socket.handshake.auth?.token;
      if (
        typeof token !== 'string' ||
        token.length > 8192 ||
        !token ||
        socket.handshake.query.token !== undefined
      ) {
        clearTimeout(timer);
        next(this.authError('UNAUTHORIZED'));
        return;
      }
      void this.tokens
        .verify(token)
        .then((verified) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          socket.handshake.auth = {};
          socket.data.verified = verified;
          next();
        })
        .catch((error: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const response =
            error instanceof UnauthorizedException ? error.getResponse() : null;
          next(
            this.authError(
              response !== null &&
                typeof response === 'object' &&
                'code' in response &&
                response.code === 'SESSION_REVOKED'
                ? 'SESSION_REVOKED'
                : error instanceof UnauthorizedException
                  ? 'UNAUTHORIZED'
                  : 'AUTH_UNAVAILABLE',
            ),
          );
        });
    });
  }
  private authError(code: string) {
    return Object.assign(new Error('登录状态无效，请重新登录'), {
      data: { code },
    });
  }
  handleConnection(socket: Socket) {
    // No client-controlled rooms or inbound business event handlers.
    this.realtime.register(socket, socket.data.verified);
  }
}
