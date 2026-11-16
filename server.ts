import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

interface CatalogItemInput {
  id: string;
  name: string;
  category: string;
  price: number;
  synonyms: string;
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Natural Language Bar Assistant "MARCELO" Multi-Customer & Strict Parser using Gemini
  app.post('/api/parse-order', async (req, res) => {
    try {
      const { transcript, catalog, existingCustomers } = req.body as {
        transcript?: string;
        catalog?: CatalogItemInput[];
        existingCustomers?: string[];
      };

      if (!transcript || typeof transcript !== 'string' || !transcript.trim()) {
        res.status(400).json({ error: 'Frase de comando vazia.' });
        return;
      }

      const cleanTranscript = transcript.trim().slice(0, 250);
      const safeCatalog = Array.isArray(catalog) ? catalog.slice(0, 100) : [];
      const safeCustomers = Array.isArray(existingCustomers) ? existingCustomers.slice(0, 100) : [];

      const catalogSummary = safeCatalog
        .map(
          (item) =>
            `- Nome: "${item.name}" | Categoria: "${item.category}" | Preço: R$ ${item.price.toFixed(2)} | Sinônimos: "${item.synonyms}"`
        )
        .join('\n');

      const customersSummary =
        safeCustomers.length > 0
          ? `Comandas abertas/ativas atualmente no bar: ${safeCustomers.map((c) => `"${c}"`).join(', ')}. Se o nome falado for parecido com uma comanda ativa, use exatamente o nome da comanda ativa.`
          : 'Nenhuma comanda ativa ainda.';

      const systemInstruction = `Você é o MARCELO, o assistente virtual inteligente de voz de um bar brasileiro (Comanda Voz).
O garçom ou dono do bar fala comandos direcionados a você, muitas vezes na correria SEM PAUSA para vários clientes seguidos!
Exemplo sem pausa: "Marcelo, marca um litrão para Thiago, marca um litrão para Jonas, marca 2 espetinhos para o Carlos".

REGRA DE OURO DE SEGURANÇA ("SE NÃO ENTENDEU, NÃO FAÇA NADA"):
1. Se a frase for confusa, incompleta, sem nome de cliente claro, ou se o produto pedido NÃO existir no Cardápio do Bar listado abaixo, você DEVE retornar "understood": false, preencher "unrecognizedReason" explicando o que não ficou claro (ex: "Produto X não está no cardápio" ou "Faltou dizer o nome do cliente") e retornar "commands": []. NUNCA invente produtos fora do cardápio nem marque em cliente genérico se não tiver certeza!
2. Se o operador falar vários pedidos seguidos sem pausa para clientes diferentes (ex: "marca 1 litrão para Thiago, marca 1 litrão para Jonas"), separe cada cliente como um item distinto dentro do array "commands", para que cada cliente receba seus itens na sua própria comanda separada!
3. Existem 3 intents possíveis para cada comando em "commands":
   - "MARCAR": Adicionar produtos do cardápio na comanda do cliente.
   - "FECHAR": Fechar/conferir a conta do cliente e ler os produtos e valor total.
   - "BAIXA": Dar baixa total ou parcial no pagamento da conta do cliente.

Cardápio do Bar (ÚNICOS PRODUTOS VÁLIDOS):
${catalogSummary}

${customersSummary}`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Comando falado no bar: "${cleanTranscript}"`,
        config: {
          systemInstruction,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              understood: {
                type: Type.BOOLEAN,
                description:
                  'True APENAS se todos os produtos existirem no cardápio e todos os clientes estiverem claros. Se houver qualquer dúvida, retorne false.',
              },
              unrecognizedReason: {
                type: Type.STRING,
                description:
                  'Explicação curta em português caso understood seja false (vazio se understood for true).',
              },
              addressedToMarcelo: {
                type: Type.BOOLEAN,
                description: 'True se o operador chamou pelo nome Marcelo.',
              },
              spokenPin: {
                type: Type.STRING,
                description: 'Código ou senha falada pelo operador, ou string vazia.',
              },
              commands: {
                type: Type.ARRAY,
                description:
                  'Lista de comandos separados por cliente (suporta múltiplos clientes falados sem pausa).',
                items: {
                  type: Type.OBJECT,
                  properties: {
                    intent: {
                      type: Type.STRING,
                      description: 'MARCAR, FECHAR ou BAIXA.',
                    },
                    customerName: {
                      type: Type.STRING,
                      description: 'Nome limpo do cliente ou mesa titular da comanda.',
                    },
                    tableLabel: {
                      type: Type.STRING,
                      description: 'Mesa ou local mencionado, ou string vazia.',
                    },
                    paymentAmount: {
                      type: Type.NUMBER,
                      description: 'Valor pago informado na baixa (0 se baixa total automática).',
                    },
                    paymentMethod: {
                      type: Type.STRING,
                      description: 'Forma de pagamento mencionada (PIX, Dinheiro, Cartão) ou PIX.',
                    },
                    keepConsuming: {
                      type: Type.BOOLEAN,
                      description: 'True se o cliente pagou mas vai continuar consumindo.',
                    },
                    items: {
                      type: Type.ARRAY,
                      description: 'Lista de produtos do cardápio quando intent for MARCAR.',
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          itemName: {
                            type: Type.STRING,
                            description: 'Nome exato do produto no cardápio.',
                          },
                          category: {
                            type: Type.STRING,
                            description: 'Categoria: cervejas, doses, porcoes, sem_alcool ou outros.',
                          },
                          quantity: {
                            type: Type.INTEGER,
                            description: 'Quantidade numérica inteira (>= 1).',
                          },
                          unitPrice: {
                            type: Type.NUMBER,
                            description: 'Preço unitário do cardápio em reais.',
                          },
                        },
                        required: ['itemName', 'category', 'quantity', 'unitPrice'],
                      },
                    },
                  },
                  required: [
                    'intent',
                    'customerName',
                    'tableLabel',
                    'paymentAmount',
                    'paymentMethod',
                    'keepConsuming',
                    'items',
                  ],
                },
              },
            },
            required: [
              'understood',
              'unrecognizedReason',
              'addressedToMarcelo',
              'spokenPin',
              'commands',
            ],
          },
        },
      });

      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText);
      res.json(parsed);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Erro ao interpretar pedido com Gemini:', message);
      res.status(500).json({
        error: message || 'Erro ao processar comando de voz no servidor.',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Comanda Voz (Assistente Marcelo) running on http://localhost:${PORT}`);
  });
}

startServer();
