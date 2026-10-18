import type { FastifyInstance } from 'fastify';
import type { AuthController } from './auth.controller';

export function registerAuthRoutes(app: FastifyInstance, controller: AuthController): void {
  // Why the arrow functions, and not app.post(url, controller.requestOtp)?
  // Passing the method alone LOSES `this`. Inside, `this.otpService` would crash with
  // "Cannot read properties of undefined". The arrow keeps `controller` as `this`.
  app.post('/v1/auth/otp/request', (request, reply) => controller.requestOtp(request, reply));
  app.post('/v1/auth/otp/verify', (request, reply) => controller.verifyOtp(request, reply));
  app.post('/v1/auth/refresh', (request, reply) => controller.refresh(request, reply));
  app.post('/v1/auth/logout', (request, reply) => controller.logout(request, reply));
}
