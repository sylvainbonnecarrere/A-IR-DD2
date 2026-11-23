import type { Socket } from 'socket.io';

import { User, IUser } from '../models/User.model';

import { verifyAccessToken, JWTPayload } from '../utils/jwt';

/**
 * US-J7-12 — Authentification JWT stricte des sockets WebSocket.
 *
 * Deny by default : un socket sans token JWT valide au handshake est rejeté.
 * Aucun identifiant temporaire de session invite n'est généré.
 * Toute ressource (room workspace, événements runtime) est filtrée par
 * l'utilisateur authentifié propriétaire.
 */

export interface AuthenticatedSocketData {
  userId: string;
  role: string;
  userInfo: {
    name: string;
    color: string;
  };
  workspaceId?: string;
}

export interface SocketAuthResult {
  payload: JWTPayload;
  user: IUser;
}

/**
 * Extrait le token JWT du handshake socket.
 * Accepte `auth.token` (socket.io client) ou `Authorization: Bearer <token>`.
 */
export function extractSocketToken(socket: Socket): string | null {
  const authToken = typeof (socket.handshake.auth as Record<string, unknown> | undefined)?.token === 'string'
    ? ((socket.handshake.auth as Record<string, unknown>).token as string).trim()
    : '';

  if (authToken) {
    return authToken;
  }

  const authorizationHeader = socket.handshake.headers.authorization;
  if (typeof authorizationHeader === 'string' && authorizationHeader.startsWith('Bearer ')) {
    const bearerToken = authorizationHeader.slice('Bearer '.length).trim();
    return bearerToken || null;
  }

  return null;
}

/**
 * Vérifie strictement le token JWT d'un socket et charge l'utilisateur associé.
 * Lance une erreur si le token est absent, invalide, ou si l'utilisateur
 * n'existe pas / est inactif. Ne crée jamais d'identité temporaire.
 */
export async function verifySocketAccessToken(socket: Socket): Promise<SocketAuthResult> {
  const token = extractSocketToken(socket);

  if (!token) {
    throw new Error('SOCKET_AUTH_REQUIRED');
  }

  let payload: JWTPayload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw new Error('SOCKET_AUTH_INVALID');
  }

  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error('SOCKET_AUTH_INVALID');
  }

  const user = await User.findById(payload.sub).select('_id email username role isActive').lean();
  if (!user || !user.isActive) {
    throw new Error('SOCKET_AUTH_INVALID');
  }

  return { payload, user: user as unknown as IUser };
}

/**
 * Génère une couleur déterministe pour un utilisateur authentifié.
 */
export function generateUserColor(seed: string): string {
  const colors = ['#00ff88', '#ff6b00', '#0066ff', '#ff0066', '#66ff00', '#ff6600'];
  const hash = Array.from(seed).reduce((acc, character) => acc + character.charCodeAt(0), 0);
  return colors[Math.abs(hash) % colors.length];
}

/**
 * Construit le SocketData authentifié à partir du résultat de vérification.
 */
export function buildAuthenticatedSocketData(result: SocketAuthResult): AuthenticatedSocketData {
  const { user } = result;
  return {
    userId: user._id.toString(),
    role: user.role,
    userInfo: {
      name: typeof user.username === 'string' && user.username.trim().length > 0 ? user.username : user.email,
      color: generateUserColor(user._id.toString()),
    },
  };
}
