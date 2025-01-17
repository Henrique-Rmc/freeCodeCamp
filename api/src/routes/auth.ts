import {
  FastifyInstance,
  FastifyPluginCallback,
  FastifyRequest
} from 'fastify';

import { createUserInput } from '../utils/create-user';
import { AUTH0_DOMAIN, HOME_LOCATION } from '../utils/env';

declare module 'fastify' {
  interface Session {
    user: {
      id: string;
    };
  }
}

const getEmailFromAuth0 = async (req: FastifyRequest) => {
  const auth0Res = await fetch(`https://${AUTH0_DOMAIN}/userinfo`, {
    headers: {
      Authorization: req.headers.authorization ?? ''
    }
  });

  if (!auth0Res.ok) {
    req.log.error(auth0Res);
    throw new Error('Invalid Auth0 Access Token');
  }

  const { email } = (await auth0Res.json()) as { email: string };
  return email;
};

const findOrCreateUser = async (fastify: FastifyInstance, email: string) => {
  const existingUsers = await fastify.prisma.user.findMany({
    where: { email },
    select: { id: true }
  });

  if(existingUsers.length === 1){
    return existingUsers[0]
  }else if(existingUsers.length > 1){
    throw new Error('Multiple users found with the same email.')
  }else{
    return (
      existingUsers ??
      (await fastify.prisma.user.create({
        data: createUserInput(email),
        select: { id: true }
      }))
    )
  }
};
 
/**
 * Route handler for development login. This is only used in local
 * development, and bypasses Auth0, authenticating as the development
 * user.
 *
 * @param fastify The Fastify instance.
 * @param _options Options passed to the plugin via `fastify.register(plugin, options)`.
 * @param done Callback to signal that the logic has completed.
 */
// TODO: 1) use POST 2) make sure we prevent login CSRF
export const devLoginCallback: FastifyPluginCallback = (
  fastify,
  _options,
  done
) => {
  fastify.get('/dev-callback', async req => {
    const email = 'foo@bar.com';

    const { id } = await findOrCreateUser(fastify, email);
    req.session.user = { id };
    await req.session.save();
    return { statusCode: 200 };
  });

  done();
};

/**
 * Route handler for Auth0 authentication.
 *
 * @param fastify The Fastify instance.
 * @param _options Options passed to the plugin via `fastify.register(plugin, options)`.
 * @param done Callback to signal that the logic has completed.
 */
// TODO: 1) use POST 2) make sure we prevent login CSRF
export const auth0Routes: FastifyPluginCallback = (fastify, _options, done) => {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.get('/callback', async req => {
    const email = await getEmailFromAuth0(req);

    const { id } = await findOrCreateUser(fastify, email);
    req.session.user = { id };
    await req.session.save();
  });

  done();
};

/**
 * Legacy route handler for development login. This mimics the behaviour of old
 * api-server which the client depends on for authentication. The key difference
 * is that this uses a different cookie (not jwt_access_token), and, if we want
 * to use this for real, we will need to account for that.
 *
 * @deprecated
 * @param fastify The Fastify instance.
 * @param _options Options passed to the plugin via `fastify.register(plugin,
 * options)`.
 * @param done Callback to signal that the logic has completed.
 */
export const devLegacyAuthRoutes: FastifyPluginCallback = (
  fastify,
  _options,
  done
) => {
  fastify.get('/signin', async (req, reply) => {
    const email = 'foo@bar.com';

    const { id } = await findOrCreateUser(fastify, email);
    req.session.user = { id };
    await req.session.save();
    await reply.redirect(HOME_LOCATION + '/learn');
  });

  fastify.get('/signout', async (req, reply) => {
    await req.session.destroy();
    await reply.redirect(HOME_LOCATION + '/learn');
  });
  done();
};
