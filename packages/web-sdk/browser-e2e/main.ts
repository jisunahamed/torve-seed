import { TorveWebClient } from '../src/client.ts';

interface BrowserRunConfig {
  relayUrl: string;
  sellerPeerId: string;
  buyerPrivateKey: string;
}

declare global {
  interface Window {
    runTorveAcceptance(config: BrowserRunConfig): Promise<{
      peerId: string;
      statusCode: number;
      body: string;
    }>;
    runPaidTorveAcceptance(config: BrowserRunConfig): Promise<{
      peerId: string;
      statusCode: number;
      channelId: string;
      authMax: string;
    }>;
    openTorveBuyer(config: BrowserRunConfig & { waitForLock?: boolean }): Promise<string>;
    closeTorveBuyer(): Promise<void>;
  }
}

let heldClient: TorveWebClient | null = null;

window.openTorveBuyer = async (config) => {
  heldClient = await TorveWebClient.create({
    relayUrl: config.relayUrl,
    privateKey: config.buyerPrivateKey,
    payment: { rpcUrl: '' },
    persistence: { waitForLock: config.waitForLock ?? false },
  });
  return heldClient.peerId;
};

window.closeTorveBuyer = async () => {
  await heldClient?.close();
  heldClient = null;
};

window.runTorveAcceptance = async (config) => {
  const client = await TorveWebClient.create({
    relayUrl: config.relayUrl,
    privateKey: config.buyerPrivateKey,
    payment: { rpcUrl: '' },
  });
  try {
    const session = await client.connect(config.sellerPeerId);
    const response = await session.request({
      path: '/v1/messages',
      provider: 'browser-acceptance',
      body: JSON.stringify({ model: 'browser-acceptance', messages: [] }),
    });
    return {
      peerId: client.peerId,
      statusCode: response.statusCode,
      body: new TextDecoder().decode(response.body),
    };
  } finally {
    await client.close();
  }
};

window.runPaidTorveAcceptance = async (config) => {
  const client = await TorveWebClient.create({
    relayUrl: config.relayUrl,
    privateKey: config.buyerPrivateKey,
    payment: {
      chainId: 31337,
      channelsContractAddress: '0xa513E6E4b8f2a923D98304ec87F64353C4D5C853',
      rpcUrl: '',
    },
    depositsClient: {
      getBuyerBalance: async () => ({ available: 10_000_000n, reserved: 0n, lastActivityAt: 0n }),
    } as never,
    channelsClient: {
      provider: null,
      getSession: async () => ({
        buyer: `0x${client.peerId}`,
        seller: `0x${config.sellerPeerId}`,
        deposit: 500_000n,
        settled: 0n,
        metadataHash: `0x${'00'.repeat(32)}`,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 900),
        settledAt: 0n,
        closeRequestedAt: 0n,
        status: 1,
      }),
    } as never,
  });
  try {
    const session = await client.connect(config.sellerPeerId);
    const response = await session.request({
      path: '/v1/messages',
      headers: { 'x-browser-paid': '1' },
      provider: 'browser-paid',
      body: JSON.stringify({ model: 'browser-paid', messages: [] }),
    });
    const channel = await waitForActiveAuthorization(client);
    return {
      peerId: client.peerId,
      statusCode: response.statusCode,
      channelId: channel.sessionId,
      authMax: channel.authMax,
    };
  } finally {
    await client.close();
  }
};

async function waitForActiveAuthorization(client: TorveWebClient) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const channel = client.listActiveChannels()[0];
    if (channel && BigInt(channel.authMax) > 0n) return channel;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('timed out waiting for persisted SpendingAuth');
}
