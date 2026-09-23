import { useState } from 'react'

/**
 * Como criar uma chave só de leitura. A regra que importa está em negrito em
 * cada corretora: qualquer permissão além de ler e a chave é recusada.
 */
export function Guide({ kind, egressIp }: { kind: 'binance' | 'okx'; egressIp: string | null }) {
  return (
    <div className="guide">
      {kind === 'binance' ? (
        <ol>
          <li>
            Na Binance, abra{' '}
            <a href="https://www.binance.com/pt-BR/my/settings/api-management" target="_blank" rel="noreferrer">
              Gerenciamento de API
            </a>{' '}
            e crie uma chave <em>gerada pelo sistema</em>.
          </li>
          <li>
            Nas restrições, deixe marcado <strong>só "Habilitar leitura"</strong> (Enable Reading). Nada de negociar, sacar ou transferir.
          </li>
          <li>{egressIp ? <IpStep ip={egressIp} /> : 'Se puder, restrinja o acesso a IPs confiáveis.'}</li>
          <li>Copie a API key e a Secret key. A secret só aparece uma vez.</li>
        </ol>
      ) : (
        <ol>
          <li>
            Na OKX, abra{' '}
            <a href="https://www.okx.com/pt-br/account/my-api" target="_blank" rel="noreferrer">
              API
            </a>{' '}
            e crie uma chave de API.
          </li>
          <li>
            Em permissões, marque <strong>só "Ler"</strong> (Read). Nada de negociar ou sacar.
          </li>
          <li>{egressIp ? <IpStep ip={egressIp} /> : 'Se puder, vincule a chave a um IP.'}</li>
          <li>Crie uma passphrase e anote. Copie a API key, a Secret key e a passphrase.</li>
        </ol>
      )}
    </div>
  )
}

function IpStep({ ip }: { ip: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(ip)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Sem clipboard (http na LAN): o IP está na tela para copiar à mão.
    }
  }
  return (
    <>
      Vincule a chave ao IP da coleta (recomendado: a chave só funciona saindo daqui){' '}
      <span className="ip">
        <code>{ip}</code>
        <button type="button" className="link-btn" onClick={() => void copy()}>
          {copied ? 'copiado' : 'copiar'}
        </button>
      </span>
    </>
  )
}
