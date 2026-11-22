import { useConfig } from '../db/hooks';
import { formatarData } from '../domain/format';
import { exportarTudo } from '../pages/Configuracoes';
import { useApp } from './AppContext';

export function AvisoBackup() {
  const config = useConfig();
  const { toast } = useApp();
  const ultimo = config.ultimo_backup;
  const dias = ultimo ? Math.floor((Date.now() - new Date(ultimo).getTime()) / 86400000) : null;
  const atrasado = dias == null || dias > 7;
  return (
    <div className={`aviso-backup ${atrasado ? 'atrasado' : ''}`}>
      <span>
        {ultimo ? `Último backup: ${formatarData(ultimo)}` : 'Nenhum backup feito ainda'}
        {atrasado && ' · seus dados ficam só neste navegador. Exporte um backup.'}
      </span>
      <button className="btn-link" onClick={async () => { await exportarTudo(); toast('Backup exportado'); }}>Exportar agora</button>
    </div>
  );
}
