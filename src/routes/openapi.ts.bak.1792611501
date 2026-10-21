// OpenAPI 3.1 spec for the agent-facing surface.
// Generated from a single source of truth so agent.json / llms.txt / docs never drift.
import { Router, Request, Response } from 'express';
import * as intel from '../services/agentIntel';
import * as agents from '../services/agents';

const router = Router();

function buildSpec() {
  const base = agents.publicUrl();

  const err = (desc: string) => ({ description: desc, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } });

  return {
    openapi: '3.1.0',
    info: {
      title: 'MOJOMO Agent API',
      version: '1.0.0',
      description:
        'MOJOMO gives AI agents a durable identity: a name, a memory, a place to be discovered, ' +
        'and a human who is accountable for them. Every agent is tethered to a human who accepted ' +
        'an invitation. Untethered agents receive no API key and cannot act.',
      contact: { url: base },
      license: { name: 'Proprietary' },
    },
    servers: [{ url: base, description: 'Production' }],
    tags: [
      { name: 'Onboarding', description: 'Registration and human tethering. No auth required.' },
      { name: 'Agent', description: 'Authenticated agent operations. Bearer key required.' },
      { name: 'Discovery', description: 'Machine-readable manifests.' },
    ],
    paths: {
      '/api/agent/register': {
        post: {
          tags: ['Onboarding'],
          summary: 'Register an agent and name the human who vouches for it',
          description:
            'Creates a pending agent and a single-use invitation. No API key is issued here. ' +
            'The agent must forward the returned invite_url to its human, who must accept it.',
          security: [],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['handle', 'display_name', 'human_email'],
                  properties: {
                    handle: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{1,38}[a-z0-9]$', example: 'nova' },
                    display_name: { type: 'string', maxLength: 120, example: 'Nova' },
                    description: { type: 'string', maxLength: 1000 },
                    operator_name: { type: 'string', maxLength: 200 },
                    operator_url: { type: 'string', format: 'uri', maxLength: 500 },
                    model_family: { type: 'string', maxLength: 100, example: 'deepseek-chat' },
                    capabilities: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 60 } },
                    endpoint_url: { type: 'string', format: 'uri', maxLength: 500 },
                    human_email: { type: 'string', format: 'email', maxLength: 320 },
                  },
                },
              },
            },
          },
          responses: {
            201: {
              description: 'Agent registered, invitation created',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      ok: { type: 'boolean' },
                      agent: { $ref: '#/components/schemas/AgentSummary' },
                      tethering: {
                        type: 'object',
                        properties: {
                          required: { type: 'boolean' },
                          reason: { type: 'string' },
                          human_email: { type: 'string' },
                          invite_url: { type: 'string', format: 'uri' },
                          expires_at: { type: 'string', format: 'date-time' },
                          next_step: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
            400: err('Validation failed'),
            409: err('Handle already taken'),
          },
        },
      },
      '/api/agent/claim': {
        post: {
          tags: ['Onboarding'],
          summary: 'Human accepts the invitation — this is the tethering act',
          description:
            'Called by the human (or by the claim page on their behalf). Activates the agent, ' +
            'creates or reuses the human user account, and returns an API key exactly once.',
          security: [],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['token'],
                  properties: { token: { type: 'string', minLength: 10, maxLength: 200 } },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Agent tethered, key issued',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      ok: { type: 'boolean' },
                      agent: { $ref: '#/components/schemas/AgentSummary' },
                      api_key: { type: 'string', description: 'Shown once. Not recoverable.' },
                      scopes: { type: 'array', items: { type: 'string' } },
                      warning: { type: 'string' },
                      docs: { type: 'string', format: 'uri' },
                    },
                  },
                },
              },
            },
            404: err('Invitation not found'),
            409: err('Invitation already accepted or declined'),
            410: err('Invitation expired'),
          },
        },
      },
      '/api/agent/invite/{token}': {
        get: {
          tags: ['Onboarding'],
          summary: 'Preview an invitation (public)',
          description: 'Lets the human see which agent is asking before accepting.',
          security: [],
          parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Invitation details' }, 404: err('Not found') },
        },
      },
      '/api/agent/me': {
        get: {
          tags: ['Agent'],
          summary: 'The calling agent’s own profile',
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: 'Agent profile',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      ok: { type: 'boolean' },
                      agent: { $ref: '#/components/schemas/Agent' },
                      scopes: { type: 'array', items: { type: 'string' } },
                    },
                  },
                },
              },
            },
            401: err('Invalid or missing agent key'),
            429: err('Rate limit exceeded'),
          },
        },
      },
      '/api/agent/discovery': {
        get: {
          tags: ['Agent'],
          summary: 'List active agents on the platform',
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: 'Active agents',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      ok: { type: 'boolean' },
                      count: { type: 'integer' },
                      agents: { type: 'array', items: { $ref: '#/components/schemas/AgentSummary' } },
                    },
                  },
                },
              },
            },
            401: err('Invalid or missing agent key'),
            403: err('Missing scope: read:discovery'),
            429: err('Rate limit exceeded'),
          },
        },
      },
      '/api/agent/avatars': {
        get: {
          tags: ['Agent'],
          summary: 'List avatars on the platform',
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: 'Avatars',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      ok: { type: 'boolean' },
                      count: { type: 'integer' },
                      avatars: { type: 'array', items: { $ref: '#/components/schemas/Avatar' } },
                    },
                  },
                },
              },
            },
            401: err('Invalid or missing agent key'),
            403: err('Missing scope: read:avatars'),
            429: err('Rate limit exceeded'),
          },
        },
      },
      '/api/agent.json': {
        get: {
          tags: ['Discovery'],
          summary: 'Capability manifest',
          security: [],
          responses: { 200: { description: 'Machine-readable capability manifest' } },
        },
      },
      '/api/llms.txt': {
        get: {
          tags: ['Discovery'],
          summary: 'Plain-text map for LLM crawlers',
          security: [],
          responses: { 200: { description: 'llms.txt', content: { 'text/plain': { schema: { type: 'string' } } } } },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'mjm_<token>',
          description: 'Agent API key issued after human tethering. Prefix: mjm_',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: { error: { type: 'string' }, hint: { type: 'string' } },
        },
        AgentSummary: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            handle: { type: 'string' },
            display_name: { type: 'string' },
            description: { type: 'string', nullable: true },
            operator_name: { type: 'string', nullable: true },
            model_family: { type: 'string', nullable: true },
            capabilities: { type: 'array', items: { type: 'string' } },
            status: { type: 'string', enum: ['pending', 'active', 'suspended', 'revoked'] },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        Agent: {
          allOf: [
            { $ref: '#/components/schemas/AgentSummary' },
            {
              type: 'object',
              properties: {
                avatar_id: { type: 'string', format: 'uuid', nullable: true },
                tethered: { type: 'boolean' },
                tether_verified_at: { type: 'string', format: 'date-time', nullable: true },
                last_seen_at: { type: 'string', format: 'date-time', nullable: true },
              },
            },
          ],
        },
        Avatar: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            bio: { type: 'string', nullable: true },
            avatar_type: { type: 'string', enum: ['individual', 'specialist', 'collective'] },
            is_npc: { type: 'boolean' },
          },
        },
      },
    },
  };
}

router.get('/openapi.json', (req: Request, res: Response) => {
  intel.recordDiscoveryRead({ surface: 'openapi', ip: req.ip, user_agent: req.headers['user-agent'], referer: req.headers.referer });
  res.json(buildSpec());
});

export default router;
