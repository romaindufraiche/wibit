// Assistant de conception : compréhension des demandes libres avec Claude (si ANTHROPIC_API_KEY est
// défini). Claude ne génère pas le parc : il traduit la demande en paramètres du générateur et
// rédige une courte réponse ; le navigateur génère le parc et en donne le résumé chiffré.
// Sans clé, ou en cas d'erreur, le navigateur utilise son propre analyseur (src/assistant/intent.ts).
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-opus-5-5';
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
export const assistantEnabled = () => !!client;

const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'action', 'changes'],
  properties: {
    reply: { type: 'string', description: 'Réponse courte en français (1 à 3 phrases), sans chiffres de résultat : le parc sera généré et résumé ensuite.' },
    action: { type: 'string', enum: ['generate', 'variant', 'help', 'real_site', 'quote', 'answer'] },
    changes: {
      type: 'object',
      additionalProperties: false,
      required: ['audience', 'capacity', 'intensity', 'loop', 'bigSlide', 'standalones', 'course', 'budget', 'lakeLength', 'lakeWidth', 'depth'],
      properties: {
        audience: nullable({ type: 'string', enum: ['kids', 'family', 'sport', 'mixed'] }),
        capacity: nullable({ type: 'integer' }),
        intensity: nullable({ type: 'integer' }),
        loop: nullable({ type: 'boolean' }),
        bigSlide: nullable({ type: 'boolean' }),
        standalones: nullable({ type: 'boolean' }),
        course: nullable({ type: 'boolean' }),
        budget: nullable({ type: 'integer' }),
        lakeLength: nullable({ type: 'integer' }),
        lakeWidth: nullable({ type: 'integer' }),
        depth: nullable({ type: 'number' }),
      },
    },
  },
};

const SYSTEM = `Tu es l'assistant de conception d'un configurateur de parcs aquatiques gonflables (modules flottants : obstacles, tours, toboggans, jonctions, boucle InfinityLoop, trampolines, volley…). Le client décrit son projet en langage naturel ; tu traduis sa demande en réglages du générateur de parcs.

Réglages (dans "changes", mets null pour tout ce que le message ne change pas) :
- audience : kids (6-12 ans), family, sport (ados/adultes, challenges), mixed (tout public)
- capacity : baigneurs simultanés (15 à 400)
- intensity : 1 (très doux) à 5 (extrême)
- loop : boucle InfinityLoop (circuit fermé)
- bigSlide : grand toboggan (Wave, Mountain, ActionLoop)
- standalones : modules autonomes en plus (volley, trampoline, tour)
- course : parcours chronométré d'un seul tenant (départ, obstacles, arrivée) pour les challenges, courses, compétitions ; implique loop=false
- budget : budget HT maximal en euros (0 = sans limite). "moins cher" sans montant : environ 80 % du budget actuel.
- lakeLength / lakeWidth / depth : dimensions du plan d'eau en mètres si le client les donne

Actions : generate (créer ou modifier le parc), variant (autre version, mêmes réglages), help (le client demande ce que tu sais faire), real_site (placer le parc sur son vrai lac, via la carte), quote (recevoir un devis), answer (simple question, pas de nouveau parc).

Réponse ("reply") : en français, chaleureuse et brève, sans inventer de chiffres de résultat (prix, capacité atteinte) : le parc sera généré et résumé juste après ta réponse. Si la demande sort du sujet des parcs aquatiques, dis-le poliment et propose de décrire le projet.`;

/**
 * @param {string} message message du client
 * @param {object} brief réglages actuels
 * @param {{role:'user'|'assistant', content:string}[]} history derniers échanges
 */
export async function askAssistant(message, brief, history = []) {
  if (!client) return null;
  const messages = [
    ...history.slice(-8).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 1500) })),
    { role: 'user', content: `Réglages actuels : ${JSON.stringify(brief)}\n\nMessage du client : ${message}` },
  ];
  // l'historique doit commencer par un message utilisateur
  while (messages.length && messages[0].role !== 'user') messages.shift();
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages,
  });
  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null;
  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) return null;
  return JSON.parse(text);
}
