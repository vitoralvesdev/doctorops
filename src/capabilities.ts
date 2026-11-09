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
          id: "adb-install",
          title: "Instalar ou atualizar APK",
          description:
            "Instala um APK do PC via ADB ou pelo envio direto do arquivo no painel (Instalar APK).",
          commands: ["install <alvo> <caminho.apk>"],
          endpoints: ["POST /api/command", "POST /api/transfer?action=install"],
        },
        {
          id: "adb-uninstall",
          title: "Remover aplicativo",
          description:
            "Remove um app pelo nome do pacote. Exige confirmar; apps de sistema podem falhar ou exigir pm uninstall --user 0.",
          commands: ["uninstall <alvo> <pacote> confirmar"],
          endpoints: ["POST /api/command"],
        },
        {
          id: "adb-screen",
          title: "Capturar a tela",
          description: "Tira um screenshot via ADB e mostra a prévia no painel.",
          commands: ["screen <alvo>"],
          entry: "/discovery",
          endpoints: ["POST /api/command", "GET /api/captures/:file"],
        },
        {
          id: "adb-push",
          title: "Enviar arquivo",
          description: "Copia um arquivo do PC para a box (padrão /sdcard/Download).",
          commands: ["push <alvo> <arquivo> [destino]"],
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
