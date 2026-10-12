import type {JSX} from 'react';
import Head from '@docusaurus/Head';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import styles from './openrouter.module.css';
import {Button, FinalCta, PageHero, Reveal, Section} from '../../components/ui';

const ROWS: Array<{dim: string; torve: string; openrouter: string}> = [
  {
    dim: 'Architecture',
    torve: 'Peer-to-peer network. Requests go direct from buyer to provider.',
    openrouter: 'Centralized aggregator. Every request flows through their servers.',
  },
  {
    dim: 'Provider onboarding',
    torve: "Permissionless. Run the node binary; you're live.",
    openrouter: 'Approval-based. Models curated by the platform.',
  },
  {
    dim: 'Payments',
    torve: 'On-chain USDC, per request, settled directly to provider wallet.',
    openrouter: 'Credit card top-ups. Platform holds earnings until payout.',
  },
  {
    dim: 'Account required',
    torve: 'No. No email, no API keys issued by a platform.',
    openrouter: 'Yes. Sign-up, API key issuance, account-level limits.',
  },
  {
    dim: 'Platform fee',
    torve: 'Provider sets the price. Network fees may support ecosystem mechanisms.',
    openrouter: 'Platform fee on top of provider pricing.',
  },
  {
    dim: 'Request privacy',
    torve: 'Prompts go peer-to-peer without a central platform account. Independent providers and infrastructure may still process or observe data.',
    openrouter: 'Every prompt transits their infrastructure.',
  },
  {
    dim: 'Can be shut down',
    torve: 'Open peer-to-peer software. Independent nodes may continue without reliance on one hosted service.',
    openrouter: 'Single company can be sued, acquired, or deplatformed.',
  },
  {
    dim: 'OpenAI SDK compatible',
    torve: 'Yes. Point base_url at your local gateway.',
    openrouter: 'Yes.',
  },
  {
    dim: 'Agent-ready',
    torve: 'Designed for it. USDC-native, no account, always-on discovery.',
    openrouter: 'Works via API key, but the account model assumes a human operator.',
  },
];

// 49 chars. The previous title ran to 65 and truncated in the SERP, losing the
// end of the phrase Google had to work with.
const TITLE = 'OpenRouter Alternative: P2P, No Account | Torve';
const DESCRIPTION =
  'Torve is a permissionless, peer-to-peer alternative to OpenRouter. Any provider can join. Requests go direct. Pay per request in USDC - no central account.';

export default function VsOpenRouter(): JSX.Element {
  return (
    <Layout title="OpenRouter Alternative" description={DESCRIPTION}>
      <Head>
        <title>{TITLE}</title>
        <meta name="description" content={DESCRIPTION} />
        <meta property="og:title" content={TITLE} />
        <meta property="og:description" content={DESCRIPTION} />
        <link rel="canonical" href="https://torveai.com/vs/openrouter/" />
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: [
              {
                '@type': 'Question',
                name: 'What is the main difference between Torve and OpenRouter?',
                acceptedAnswer: {
                  '@type': 'Answer',
                  text:
                    "OpenRouter is a centralized aggregator; Torve is a peer-to-peer network. OpenRouter curates which providers are listed and routes every request through their servers. Torve lets any provider join permissionlessly, and requests go directly from the buyer's local gateway to the provider.",
                },
              },
              {
                '@type': 'Question',
                name: 'Do I need an account to use Torve?',
                acceptedAnswer: {
                  '@type': 'Answer',
                  text:
                    'No. Torve has no sign-up, no email, and no platform-issued API keys. A local gateway connects you to the peer-to-peer network, and payments settle on-chain in USDC.',
                },
              },
              {
                '@type': 'Question',
                name: 'How does Torve handle payments compared to OpenRouter?',
                acceptedAnswer: {
                  '@type': 'Answer',
                  text:
                    "OpenRouter uses credit card top-ups and holds provider earnings until a payout. Torve settles each request on-chain in USDC, directly to the provider's wallet. There is no platform escrow.",
                },
              },
              {
                '@type': 'Question',
                name: 'Is Torve OpenAI SDK compatible like OpenRouter?',
                acceptedAnswer: {
                  '@type': 'Answer',
                  text:
                    'Yes. Point the OpenAI SDK base_url at your local Torve gateway (http://localhost:8377/v1 by default). Existing OpenAI or OpenRouter code works with no changes beyond the URL.',
                },
              },
            ],
          })}
        </script>
      </Head>

      <PageHero
        kicker="OpenRouter alternative"
        title="A permissionless, peer-to-peer alternative to OpenRouter."
        lead="Same OpenAI-compatible API. Any provider can join. Pay per request in USDC. No central account, independent providers, open peer-to-peer routing.">
        <Button to="/docs/install" arrow>Install Torve</Button>
        <Button href="https://torvestats.com/network" variant="ghost">Live pricing</Button>
      </PageHero>

      <Section tone="tinted">
        <Reveal className={styles.table}>
          <div className={styles.tableHead}>
            <div className={styles.colDim} />
            <div className={styles.colAnt}>Torve</div>
            <div className={styles.colOr}>OpenRouter</div>
          </div>
          {ROWS.map((row) => (
            <div key={row.dim} className={styles.tableRow}>
              <div className={styles.colDim}>{row.dim}</div>
              <div className={styles.colAnt}>{row.torve}</div>
              <div className={styles.colOr}>{row.openrouter}</div>
            </div>
          ))}
        </Reveal>
      </Section>

      <Section>
        <div className={styles.listGrid}>
          <Reveal className={styles.listCard}>
            <h2 className={styles.listTitle}>When to pick Torve</h2>
            <ul className={styles.list}>
              <li>You want to run inference without creating another SaaS account.</li>
              <li>You're building an agent that needs to pay for its own inference.</li>
              <li>You want payments to settle per request, on-chain, with no platform holding funds.</li>
              <li>You want to <Link to="/providers">serve</Link> a model and get paid without applying to a platform.</li>
              <li>You need open peer-to-peer routing that does not rely on one hosted service.</li>
            </ul>
          </Reveal>
          <Reveal className={styles.listCard} delay={100}>
            <h2 className={styles.listTitle}>When OpenRouter might still fit</h2>
            <ul className={`${styles.list} ${styles.listMuted}`}>
              <li>You prefer a credit-card-funded account over an on-chain wallet.</li>
              <li>You want a single vendor relationship with a support contact.</li>
              <li>You're fine with the platform routing every request through their servers.</li>
            </ul>
          </Reveal>
        </div>
      </Section>

      <FinalCta
        title="Get started in one command."
        note={
          <>
            <span>Open source. Runs locally.</span>
            <a href="/docs/install">Full install guide</a>
          </>
        }>
        <code className={styles.installCode}>npm install -g @torveai/cli</code>
      </FinalCta>
    </Layout>
  );
}
