import { VERSION } from "./core/settings.js";

export type Capability = {
  id: string;
  title: string;
  description: string;
  entry?: string;
  commands?: string[];
  endpoints?: string[];
};

export type CapabilityArea = {
  id: "discovery" | "adb" | "system" | "ai";
  title: string;
  summary: string;
  primary?: boolean;
  capabilities: Capability[];
};

export function getCapabilities() {
  const areas: CapabilityArea[] = [
    {
      id: "discovery",
      title: "Descoberta na rede (principal)",
      summary:
        "Modo oficial de conexão: localiza aparelhos na LAN, identifica o tipo e alimenta o terminal e as operações de manutenção.",
      primary: true,
      capabilities: [
        {
          id: "scan",
          title: "Varrer a rede local",
          description:
            "Combina hosts conhecidos, adb devices, mDNS, SSDP/UPnP, cache ARP e varredura TCP da sub-rede principal.",
          entry: "/discovery",
          endpoints: ["POST /api/scan/start", "GET /api/scan/status", "GET /api/devices"],
        },
        {
          id: "identify",
          title: "Identificar tipo e modelo",
          description:
            "Classifica Android TV, TV Box, Android, Apple ou desconhecido e enriquece com AirPlay /info, Google Cast e descrição UPnP.",
        },
        {
          id: "wake",
          title: "Acordar aparelho (Wake-on-LAN)",
          description: "Envia magic packet para hosts conhecidos quando o keep-alive encontra um IP offline (configurável).",
        },
        {
          id: "host-cache",
          title: "Gerenciar hosts conhecidos",
          description: "Consulta e limpa o cache de IPs, portas e nomes já vistos.",
          endpoints: ["GET /api/hosts", "DELETE /api/hosts"],
        },
      ],
    },
    {
      id: "adb",
      title: "ADB",
      summary:
        "Funciona quando a box expõe a depuração e autoriza a conexão. É o canal usado para as operações de manutenção.",
      capabilities: [
        {
          id: "adb-list",
          title: "Coletar dados por ADB",
          description: "Identifica o aparelho e coleta fabricante, modelo, Android, RAM, armazenamento, uptime e bateria.",
          commands: ["list <ip-ou-nome>"],
          endpoints: ["POST /api/command"],
        },
        {
          id: "adb-pair",
          title: "Parear depuração sem fio (Android 11+)",
          description: "Pareia usando o código exibido na TV e depois conecta na porta de conexão.",
          commands: ["pair <ip:porta> <código>", "connect <ip:porta>"],
        },
        {
          id: "adb-connect",
          title: "Conectar e desconectar",
          description: "Gerencia sessões ADB por IP, nome ou porta.",
          commands: ["connect <ip[:porta]>", "disconnect <ip[:porta]>"],
        },
        {
          id: "adb-apps",
          title: "Listar aplicativos",
          description: "Lista pacotes de usuário e de sistema instalados na box.",
          commands: ["apps <alvo>"],
          endpoints: ["POST /api/command"],
        },
        {
          id: "adb-analyze",
          title: "Analisar o que pode ser removido",
          description:
            "Classifica os pacotes de sistema em remover, revisar e manter, com base no que a box usa para boot, configuração, launcher, áudio, arquivos, OTA e ADB.",
          commands: ["analyze <alvo>"],
          endpoints: ["POST /api/command"],
        },
        {
          id: "adb-play",
          title: "Certificação do Play Store",
          description:
            "Lê o GSF ID, o veredito e a data de emissão, as versões do Play e a identidade do firmware (autor, compilação, patch e fingerprints por partição), explica a recusa e força um novo check-in para o Google reavaliar.",
          commands: ["play <alvo>", "play <alvo> recheck [limpar]"],
          entry: "/functions.html",
          endpoints: ["POST /api/command"],
        },
        {
          id: "adb-firmware",
          title: "Atualização de firmware",
          description:
            "Encontra a ROM na pasta roms/, confere formato, SoC, placa, identidade, assinatura e espaço (o conteúdo manda mais que o nome do arquivo), faz backup de bootloader/boot/recovery/vbmeta via root e escolhe a rota: OTA .zip assinado segue ao Local Update com SHA-256 conferido e a instalação é iniciada automaticamente após a verificação do fabricante; imagem completa .img/.rar ou .zip com .img não é instalável por ADB, então o comando gera o flash-kit.txt, termina com NADA FOI INSTALADO e não finge sucesso. Aceita .zip/.rar contendo a imagem: o .img é lido em streaming, sem extrair para o disco.",
          commands: [
            "update firmware",
            "update firmware <alvo> [rom]",
            "update firmware <alvo> <rom> confirmar",
          ],
          entry: "/functions.html",
          endpoints: ["POST /api/command"],
        },
        {
          id: "adb-firmware-ota",
          title: "Atualização online do firmware",
          description:
            "Força a checagem de atualização online do fabricante (serviço OtaService do com.softwinner.update via root) no próprio aparelho e, com confirmar, baixa e aplica o pacote oferecido. Relata o motivo exato quando o canal oficial está fora do ar: domínios mortos (NXDOMAIN), porta recusada ou política de cleartext do Android 10 — sem fingir que atualizou.",
          commands: ["update ota <alvo> [confirmar]"],
          entry: "/functions.html",
          endpoints: ["POST /api/command"],
        },
        {
          id: "adb-firmware-scan",
          title: "Buscar firmware na internet",
          description:
            "Lê o hardware pela box (modelo, placa, SoC, Android, build, identidade e certificação, como em list e play), procura ROMs para esse aparelho na internet, ranqueia por compatibilidade e data e mostra se a fonte é o fabricante ou um terceiro (blog, fórum, espelho). Lê também os nomes dos arquivos no link de download e trata como não confirmado o candidato cuja página anuncia uma placa mas o arquivo é de outra linha. Não baixa nem instala nada.",
          commands: ["scan firmware <alvo> [limite]"],
          entry: "/functions.html",
          endpoints: ["POST /api/command"],
        },
        {
          id: "adb-functions",
          title: "Funções guiadas",
          description:
            "Página com seleção de operação e campos dinâmicos para executar diagnósticos, conexão, apps, launcher, tela, arquivos e reboot, com histórico de execuções no estilo de log.",
          entry: "/functions.html",
          endpoints: ["POST /api/command", "POST /api/transfer"],
        },
        {
          id: "adb-install",
          title: "Instalar ou atualizar APK",
          description:
            "Instala um APK do PC via ADB ou pelo envio direto do arquivo no painel (Instalar APK).",
          commands: ["install <alvo> <caminho.apk>"],
          entry: "/functions.html",
          endpoints: ["POST /api/command", "POST /api/transfer?action=install"],
        },
        {
          id: "adb-uninstall",
          title: "Remover aplicativo",
          description:
            "Remove um app pelo nome do pacote. Exige confirmar; apps de sistema podem falhar ou exigir pm uninstall --user 0.",
          commands: ["uninstall <alvo> <pacote> confirmar"],
          entry: "/functions.html",
          endpoints: ["POST /api/command"],
        },
        {
          id: "adb-launcher",
          title: "Ícones do launcher",
          description:
            "Em launchers com tiles fixos, esconde ícones de apps removidos via overlay de recursos (RRO). Permite inspecionar, limpar, esconder, mostrar e desfazer.",
          commands: [
            "launcher <alvo> [info]",
            "launcher <alvo> clean",
            "launcher <alvo> hide <pacote>",
            "launcher <alvo> show <pacote>",
            "launcher <alvo> rollback",
          ],
          endpoints: ["POST /api/command"],
        },
        {
          id: "adb-screen",
          title: "Capturar a tela",
          description: "Tira um screenshot via ADB e mostra a prévia no painel.",
          commands: ["screen <alvo>"],
          entry: "/functions.html",
          endpoints: ["POST /api/command", "GET /api/captures/:file"],
        },
        {
          id: "adb-push",
          title: "Enviar arquivo",
          description: "Copia um arquivo do PC para a box (padrão /sdcard/Download).",
          commands: ["push <alvo> <arquivo> [destino]"],
          entry: "/functions.html",
          endpoints: ["POST /api/command", "POST /api/transfer?action=push"],
        },
        {
          id: "adb-reboot",
          title: "Reiniciar a box",
          description: "Reinicia o aparelho via ADB. Exige confirmar; a sessão cai e volta em alguns segundos.",
          commands: ["reboot <alvo> confirmar"],
          endpoints: ["POST /api/command"],
        },
        {
          id: "adb-keepalive",
          title: "Manter sessão viva",
          description: "Testa periodicamente hosts ADB conhecidos, reconecta e pode acordar a box via Wake-on-LAN.",
        },
        {
          id: "adb-abort",
          title: "Abortar operação",
          description: "Cancela uma coleta em andamento.",
          commands: ["abort", "help"],
        },
      ],
    },
    {
      id: "system",
      title: "Sistema",
      summary: "Observabilidade e ajustes do servidor.",
      capabilities: [
        {
          id: "logs",
          title: "Logs em tempo real",
          description: "Atividade do servidor via Server-Sent Events, exibida no painel de descoberta.",
          endpoints: ["GET /api/logs"],
        },
        {
          id: "config",
          title: "Configurações de descoberta",
          description: "Ajusta etapas da varredura, tempos, keep-alive e Wake-on-LAN.",
          entry: "/settings.html",
          endpoints: ["GET /api/config", "POST /api/config", "POST /api/config/reset"],
        },
        {
          id: "capabilities",
          title: "Mapa de capacidades",
          description: "Esta lista, também disponível em JSON.",
          entry: "/commands.html",
          endpoints: ["GET /api/capabilities"],
        },
      ],
    },
    {
      id: "ai",
      title: "Agent com IA (planejado)",
      summary:
        "Evolução do projeto: permitir interação em linguagem natural com o aparelho, com interpretação de contexto e execução de operações compatíveis com as permissões disponíveis.",
      capabilities: [
        {
          id: "ai-natural",
          title: "Comandos em linguagem natural",
          description:
            "Planejado — ainda não implementado. A base atual do projeto é descoberta de dispositivos + operações ADB.",
        },
      ],
    },
  ];

  return { version: VERSION, areas };
}
