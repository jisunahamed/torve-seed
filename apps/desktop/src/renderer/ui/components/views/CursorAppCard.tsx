import { useEffect, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Copy01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { BrandIcon } from '../brand/BrandIcon';
import styles from './VprToolsView.module.scss';

type Props = { appId?: 'cursor' | 'cline-roo'; label?: string; brand?: Parameters<typeof BrandIcon>[0]['brand'] };

/** Guided-copy connector for IDEs that keep provider settings in private
 * encrypted/SQLite state. Torve never edits that state directly. */
export function CursorAppCard({ appId = 'cursor', label = 'Cursor', brand = 'cursor' }: Props) {
  const [connected, setConnected] = useState(false);
  const [copied, setCopied] = useState(false);
  const [models, setModels] = useState<Array<{ id: string }>>([]);
  const [model, setModel] = useState('');
  const baseURL = `http://127.0.0.1:8378/app/${appId}/v1`;
  useEffect(() => {
    const bridge = window.torveDesktop;
    void Promise.all([bridge?.torveAccountGet?.(), bridge?.torveModelsGet?.(), bridge?.torveOverridesGet?.()]).then(([account, catalog, overrides]) => {
      setConnected(account?.connected === true);
      setModels(catalog?.models ?? []);
      setModel(overrides?.[appId]?.modelId ?? '');
    });
    const unsubModels = bridge?.onTorveModelsUpdated?.((catalog) => {
      if (Array.isArray(catalog?.models)) setModels(catalog.models);
    });
    return () => { unsubModels?.(); };
  }, [appId]);
  const copy = () => { void navigator.clipboard.writeText(`Base URL: ${baseURL}\nToken: torve-local-proxy\nModel: ${model || 'torve'}`).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }); };
  const choose = async (value: string) => { setModel(value); await window.torveDesktop?.torveOverrideSet?.(appId, value ? { modelId: value, enabled: true } : null); };
  return <div className={`${styles.appPill}${connected ? ` ${styles.appPillConnected}` : ''}`}>
    <div className={styles.appHead}>
      <span className={styles.appIdentity}><BrandIcon brand={brand} size={24} /><span className={styles.appText}><span className={styles.appName}>{label}</span><span className={styles.appMeta}>Guided copy · private settings are not modified</span></span></span>
      <button type="button" className={styles.connectAction} disabled={!connected} onClick={copy}><HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} size={14} />{copied ? 'Copied' : 'Copy setup'}</button>
    </div>
    {models.length > 0 ? <label className={styles.modelPicker}><span>Model</span><select value={model} onChange={(event) => void choose(event.target.value)}><option value="">Automatic</option>{models.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}</select></label> : null}
  </div>;
}
