# DoctorOps

<p align="center">
  **Gerenciamento e manutenção de dispositivos Android TV pela rede local.**
</p>

O **DoctorOps** é uma ferramenta desenvolvida em Node.js e TypeScript para localizar, conectar e realizar operações de manutenção em Android TVs e TV Boxes pela rede.

O modo oficial de conexão é a **descoberta de dispositivos + ADB**. A partir do painel de descoberta é possível identificar aparelhos e abrir um terminal ADB. A página **Funções** transforma as tarefas de manutenção em um formulário guiado — listar e analisar apps, conferir a certificação do Play, instalar ou remover APKs, controlar ícones do launcher, capturar a tela, transferir arquivos e reiniciar — com o resultado em um histórico visual de execuções.

A proposta de evolução é tornar a aplicação **inteligente**: no futuro, um **Agent com IA** deverá permitir interação em linguagem natural com o aparelho, interpretando o contexto e executando operações compatíveis com as permissões disponíveis. Esse recurso ainda é um roadmap e não está implementado.

## Prévia da interface

Abaixo estão algumas capturas reais do painel, mostrando a descoberta de dispositivos, o terminal integrado e as ferramentas de manutenção por ADB. Os endereços IP locais foram ocultados nas imagens.

<p align="center">
  <img src="docs/images/discovery-adb.png" alt="Painel de descoberta de dispositivos e terminal ADB" width="100%">
</p>

> **Status do projeto:** em desenvolvimento ativo. A descoberta de dispositivos e o modo ADB já possuem funcionalidades operacionais. O Agent com IA é planejado e ainda não está disponível.

---

## Índice

- [Visão geral](#visão-geral)
- [Funcionalidades](#funcionalidades)
- [Instalação](#instalação)
- [Gerar os instaladores](#gerar-os-instaladores)
- [Desenvolvimento](#desenvolvimento)
- [Executando o projeto](#executando-o-projeto)
- [Conectando um dispositivo com ADB](#conectando-um-dispositivo-com-adb)
- [Comandos disponíveis no ADB](#comandos-disponíveis-no-adb)
- [Certificação do Play Store](#certificação-do-play-store)
- [Atualização de firmware (ROM)](#atualização-de-firmware-rom)
- [Buscar firmware na internet](#buscar-firmware-na-internet)
- [Descoberta de dispositivos](#descoberta-de-dispositivos)
- [Agent com IA — planejado](#agent-com-ia--planejado)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Rede e segurança](#rede-e-segurança)
- [Limitações conhecidas](#limitações-conhecidas)
- [Tecnologias](#tecnologias)
- [Contribuindo](#contribuindo)

---

## Visão geral

A ideia do DoctorOps é centralizar operações de manutenção de dispositivos Android TV em um painel acessível pelo computador, sem precisar executar manualmente cada tarefa no terminal.

| Módulo             | Objetivo                                                       | Situação  |
| ------------------ | -------------------------------------------------------------- | --------- |
| Descoberta de rede | Localizar e identificar dispositivos na LAN                    | Funcional |
| ADB                | Executar operações de manutenção nos dispositivos              | Funcional |
| Agent com IA       | Permitir interação inteligente e comandos em linguagem natural | Planejado |

A página inicial redireciona para `/discovery`, que é o ponto de entrada do modo oficial de conexão.

## Funcionalidades

### Descoberta de dispositivos — modo oficial

O sistema reúne diferentes fontes de informação para localizar dispositivos na rede local:

- Dispositivos ADB conhecidos.
- Descoberta mDNS.
- SSDP / UPnP.
- Serviços relacionados a Cast, Android TV Remote e AirPlay.
- Cache ARP e varredura TCP da sub-rede.
- Identificação por nome, fabricante, modelo e evidências de rede.
- Classificação de dispositivos por tipo e, quando os protocolos fornecem esses dados, por marca/modelo (por exemplo, iPhone, Mac, Samsung/Motorola Android e Android TV/Box).
- Agrupamento visual por contexto — TVs/TV Boxes, celulares/tablets, computadores e rede — mantendo cada IP separado.
- Exclusão de endpoints conhecidos de ambientes virtuais, como aliases Docker e interfaces de containers, para priorizar aparelhos físicos.
- Identificação de dispositivos conectados por USB, quando disponíveis pelo ADB.
- Wake-on-LAN para dispositivos conhecidos.

A descoberta depende dos serviços que cada aparelho disponibiliza na rede. Portanto, nem todo dispositivo será identificado automaticamente.

### ADB — disponível

O módulo ADB permite executar operações diretamente em dispositivos Android autorizados:

- Identificar o dispositivo e consultar informações do sistema.
- Listar aplicativos instalados, incluindo aplicativos de sistema.
- Analisar quais pacotes de sistema podem ser removidos sem afetar boot, configuração e gerenciamento.
- Conferir o status de certificação do Play Store e forçar um novo check-in com o Google.
- Procurar ROMs na internet a partir do hardware real da box, classificar a fonte como oficial ou de terceiros e recomendar a melhor, sem baixar nem instalar.
- Localizar e validar uma ROM na pasta `roms/` (`.img`, OTA `.zip` ou `.zip`/`.rar` com a imagem dentro, lida sem extrair) e executar a rota real: OTA pelo Local Update com início automático da instalação; imagem completa não é instalável por ADB e o comando termina com "NADA FOI INSTALADO", com backup das partições críticas e conferência de SHA-256.
- Instalar e atualizar arquivos APK.
- Desinstalar aplicativos, com limpeza automática do ícone no launcher.
- Esconder, mostrar e restaurar ícones de launchers com tiles fixos.
- Capturar a tela do dispositivo.
- Transferir arquivos do computador para a TV Box.
- Reiniciar o dispositivo.
- Conectar, desconectar e parear dispositivos pela rede.
- Manter conexões ADB conhecidas e tentar reconectá-las.

---

## Instalação

A forma oficial de usar o DoctorOps é pelo instalador do seu sistema. Não é preciso ter Node.js, npm ou Platform Tools: o runtime e o `adb` vão embutidos.

| Ambiente | Arquivo                              | Como instalar                   |
| -------- | ------------------------------------ | ------------------------------- |
| Windows  | `DoctorOps-<versão>-setup.exe`       | execute o instalador            |
| macOS    | `DoctorOps-<versão>-universal.dmg`   | abra e arraste para Applications |

Só a depuração ADB precisa estar habilitada no dispositivo e autorizada na primeira conexão.

### Windows

1. Execute `DoctorOps-<versão>-setup.exe`.
2. A instalação é por usuário, em `%LOCALAPPDATA%\Programs\DoctorOps`, e não pede administrador.
3. Abra pelo atalho do Menu Iniciar ou da área de trabalho. O navegador abre sozinho em `http://localhost:3000`.
4. Se o Windows SmartScreen avisar sobre editor desconhecido, use **Mais informações > Executar assim mesmo**.
5. Na primeira execução, permita o acesso no firewall para redes privadas (necessário para a box alcançar o painel).

Os dados ficam em `%LOCALAPPDATA%\DoctorOps` (ROMs, backups, capturas, `scan-config.json`, `known-hosts.json`) e continuam lá após atualizar ou desinstalar. O atalho **Pasta de dados** no Menu Iniciar abre essa pasta.

### macOS

1. Abra `DoctorOps-<versão>-universal.dmg` e arraste o app para **Applications**.
2. O `.dmg` é universal (Apple Silicon e Intel) e leva o Node das duas arquiteturas; o launcher escolhe na hora.
3. Como o app não é notarizado, no primeiro uso use **clique-direito > Abrir** (ou **Ajustes do Sistema > Privacidade e Segurança > Abrir mesmo assim**).
4. Na primeira execução o macOS pode pedir para permitir conexões de entrada para o Node; permita para a box acessar o painel.
5. O navegador abre sozinho em `http://localhost:3000`. O servidor roda numa janela do Terminal, que mostra os logs: feche a janela ou use `Ctrl+C` para parar.

Os dados ficam em `~/Library/Application Support/DoctorOps` (`roms/`, `backups/`, `captures/`), e os logs aparecem na janela do Terminal.

---

## Gerar os instaladores

Ferramentas baixadas e verificadas no build (versões fixas em `packaging/tools.json`):

| Ferramenta     | Versão  |
| -------------- | ------- |
| Node.js        | 24.22.3 |
| Platform Tools | 37.0.3  |

```bash
npm ci

# Windows -> dist-installers/DoctorOps-<versão>-setup.exe
npm run build:win

# macOS -> dist-installers/DoctorOps-<versão>-universal.dmg
npm run build:mac
```

O build do Windows precisa do [Inno Setup](https://jrsoftware.org/isdl.php) (`winget install -e --id JRSoftware.InnoSetup`). O `.dmg` só é gerado no macOS. O workflow `.github/workflows/build-installers.yml` monta os dois artefatos no GitHub Actions (Windows e macOS runners) e pode ser disparado manualmente.

Para trocar Node ou Platform Tools, edite `packaging/tools.json` (incluindo os checksums) e rode `npm run tools` para baixar novamente.

---

## Desenvolvimento

Para alterar o código e rodar a partir da fonte (não é necessário para usar o programa):

- Node.js 20 ou superior e npm;
- para o módulo ADB local, Android SDK Platform Tools com `adb` no `PATH`.

```bash
git clone https://github.com/vitoralvesdev/doctorops.git
cd doctorops
npm install
npm run dev
```

O servidor de desenvolvimento fica em `http://localhost:3000`.

---

## Executando o projeto

Depois de instalar (ou iniciar o servidor em desenvolvimento), o DoctorOps abre o navegador sozinho. As páginas também podem ser acessadas manualmente:

| Página              | Endereço                              | Descrição                               |
| ------------------- | ------------------------------------- | --------------------------------------- |
| Descoberta (padrão) | `http://localhost:3000`               | Redireciona para `/discovery`           |
| Descoberta          | `http://localhost:3000/discovery`     | Dispositivos encontrados e terminal ADB |
| Comandos            | `http://localhost:3000/commands.html` | Referência de comandos e capacidades    |
| Configurações       | `http://localhost:3000/settings.html` | Configurações e dispositivos em cache   |

### Acesso pela rede local

Por padrão, o servidor escuta em `0.0.0.0:3000`, permitindo que as páginas sejam abertas por outros dispositivos da rede. A API, porém, continua restrita a requisições locais (veja [Rede e segurança](#rede-e-segurança)).

Para executar somente no próprio computador, no modo desenvolvimento:

```bash
HOST=127.0.0.1 npm run dev
```

No PowerShell do Windows:

```powershell
$env:HOST="127.0.0.1"; npm run dev
```

Na primeira execução, o Windows pode solicitar autorização para o Node.js no Firewall. Permita o acesso em redes privadas para que os dispositivos da LAN consigam alcançar o servidor.

---

## Conectando um dispositivo com ADB

O ADB é a forma de conexão usada pelas operações de manutenção do projeto.

Existem duas possibilidades principais: conexão USB ou conexão pela rede Wi-Fi/Ethernet.

### Opção 1 — USB

1. Ative as opções do desenvolvedor na TV Box.
2. Habilite a depuração USB.
3. Conecte o aparelho ao computador por USB.
4. Aceite a autorização de depuração exibida na TV.
5. No terminal, execute:

```bash
adb devices
```

O serial do aparelho aparecerá na lista. Esse serial pode ser utilizado como alvo dos comandos do projeto.

### Opção 2 — ADB pela rede

**Android 11 ou superior:**

1. Ative as opções do desenvolvedor.
2. Habilite a opção **Depuração sem fio**.
3. Consulte o endereço e a porta de pareamento exibidos pelo Android.
4. Execute o pareamento:

```text
pair <ip:porta-de-pareamento> <código>
```

5. Depois, conecte usando o endereço e a porta de conexão:

```text
connect <ip:porta-de-conexão>
```

**Android 10 ou inferior:**

1. Habilite a depuração ADB pela rede, quando disponível na firmware.
2. Execute:

```bash
adb connect 192.168.1.20:5555
```

3. Aceite a autorização de depuração exibida na TV, se solicitada.

A disponibilidade dessas opções depende da versão do Android e da firmware instalada pelo fabricante.

### Box antiga (Android 9/10) sem depuração de rede

Muitas TV boxes Allwinner (H6/H616) e Amlogic expõem o ADB apenas pelo cabo. Nesses casos a porta `5555` fica fechada e a descoberta mostra o aparelho como **desconhecido** — não é falta de identificação, é ausência de serviço.

1. Diagnostique o IP:

```text
probe 192.168.1.26
```

O comando testa portas TCP, banners HTTP/RTSP, SSDP/mDNS/NetBIOS, TTL e o fabricante do módulo Wi-Fi pelo MAC. Use `probe <ip> full` para varrer 1–65535.

2. Antes de tentar o cabo, confirme se o PC enxerga alguma coisa:

```text
usb
```

O comando mostra o que o `adb` lista e o que o Windows enumerou (VID/PID, classe e nome), com a diferença em relação à consulta anterior. Rode `usb` sem o cabo, conecte o cabo e rode `usb` de novo: se nada novo aparecer, o cabo é só de carga ou a porta não faz conexão de dados.

3. Com o cabo OTG conectado uma única vez, ligue o ADB de rede:

```text
tcpip <serial-usb>
```

O comando descobre o IP pela shell, executa `adb tcpip 5555`, tenta persistir `persist.adb.tcp.port` quando há root e conecta pela rede. Sem root, a porta volta ao padrão após reiniciar.

4. Sem cabo, as alternativas são console **UART 3,3 V** no header da placa (shell root e `setprop persist.adb.tcp.port 5555`) ou repack da ROM stock com `persist.adb.tcp.port=5555` e flash por cartão SD.

Atenção: muitas caixas H6/H616 só têm portas **USB-A HOST** (2x USB 2.0). Nesse caso nenhum cabo USB liga o aparelho ao PC — não existe porta OTG. Se a porta de depuração for USB-C/micro-USB, um cabo de celular comum (com dados) resolve; se for USB-A rotulada OTG, é necessário um cabo A-A macho-macho.

Se as opções do desenvolvedor tiverem **USB device mode**, deixe-a ativada junto com **Depuração USB**: é ela que coloca a porta OTG em modo dispositivo e permite que o PC enxergue o ADB. Ela não abre a porta 5555 na rede — apenas habilita o ADB pelo cabo. Cabos só de carga não funcionam; teste com um cabo de dados e uma porta USB 2.0 traseira do PC.

Android 11+ com **Depuração sem fio** não existe em ROM stock H6/H616; ROM de H618 não é compatível com H6/H616 e pode brickar a placa.

---

## Comandos disponíveis no ADB

Os comandos podem ser executados pelo terminal da interface `/discovery` ou pelo terminal do sistema, conforme indicado.

| Comando                                                           | Descrição                                   |
| ----------------------------------------------------------------- | ------------------------------------------- |
| `list <ip-ou-serial>`                                             | Consulta informações do dispositivo         |
| `apps <alvo>`                                                     | Lista aplicativos instalados                |
| `analyze <alvo>`                                                  | Classifica o que pode ser removido          |
| `play <alvo> [recheck [limpar]]`                                  | Diagnostica a certificação do Play          |
| `scan firmware <alvo> [limite]`                                   | Busca ROMs na internet e classifica a fonte |
| `update firmware [list\|<alvo> [rom] [confirmar]]`                | Valida a ROM e executa a rota do formato    |
| `update ota <alvo> [confirmar]`                                   | Força a atualização online do firmware      |
| `install <alvo> <apk>`                                            | Instala ou atualiza um APK                  |
| `uninstall <alvo> <pacote> confirmar`                             | Desinstala um aplicativo                    |
| `launcher <alvo> [clean\|hide <pacote>\|show <pacote>\|rollback]` | Limpa ícones fixos de apps removidos        |
| `screen <alvo>`                                                   | Captura a tela da TV                        |
| `push <alvo> <arquivo> [destino]`                                 | Envia um arquivo para o dispositivo         |
| `reboot <alvo> confirmar`                                         | Reinicia o dispositivo                      |
| `pair <ip:porta> <código>`                                        | Pareia a depuração sem fio                  |
| `probe <ip> [full]`                                               | Diagnóstico profundo de um IP               |
| `usb`                                                             | Aparelhos no USB e o que o sistema enumerou |
| `tcpip <serial> [porta]`                                          | Converte um aparelho USB em ADB de rede     |
| `connect <ip[:porta]>`                                            | Conecta um dispositivo pela rede            |
| `disconnect <ip[:porta]>`                                         | Encerra uma conexão                         |
| `clear`                                                           | Limpa só a tela do terminal                 |
| `abort`                                                           | Interrompe uma operação compatível          |
| `help`                                                            | Exibe a ajuda de comandos                   |

Exemplo:

```bash
list 192.168.1.20
```

Listar aplicativos:

```bash
apps 192.168.1.20
```

Analisar o que dá para remover sem quebrar a box:

```bash
analyze 192.168.1.20
```

O `analyze` não altera nada: separa os pacotes de sistema em **pode remover** (testes de fábrica, protetores de tela, impressão, galeria, câmera), **revisar** (Google, telefonia, navegador) e **manter** (boot, configurações, launcher, áudio, arquivos, OTA e ADB). Ele mostra o navegador padrão detectado e o comando para reverter um pacote removido com `cmd package install-existing`.

Instalar um APK:

```bash
install 192.168.1.20 ./meu-aplicativo.apk
```

Desinstalar um aplicativo:

```bash
uninstall 192.168.1.20 com.exemplo.aplicativo confirmar
```

Em launchers de fabricante com tiles fixos, o ícone não sai junto com o pacote. Nesses casos o `uninstall` também limpa o ícone automaticamente, e o comando `launcher` permite controlar isso:

```bash
launcher 192.168.1.20            # mostra launcher, tiles e ícones órfãos
launcher 192.168.1.20 clean      # esconde todos os tiles de apps que não existem mais
launcher 192.168.1.20 hide com.google.android.youtube.tv
launcher 192.168.1.20 rollback   # desfaz e volta ao launcher original
```

A limpeza usa um overlay de recursos: o APK do launcher não é alterado e o `rollback` desfaz na hora. No Android 10 o overlay só aplica se estiver assinado com o mesmo certificado do launcher (ou pré-instalado em `/system`) — o HLauncher usa a testkey pública do AOSP, então o programa assina o overlay com ela. Os perfis de launcher ficam em `src/launcher/profile.ts` e a aplicação do overlay em `src/launcher/overlay.ts`.

Aparelhos já testados e o que foi validado em cada um estão na seção [Dispositivos validados](#dispositivos-validados).

O alvo pode ser um endereço IP, um endereço com porta ou o serial USB exibido pelo `adb devices`.

### Dispositivos validados

Catálogo dos aparelhos testados com o DoctorOps. A homologação é feita em etapas, da mais básica para a mais invasiva:

| Etapa | O que valida                                                |
| ----- | ----------------------------------------------------------- |
| 1     | `list` encontra o aparelho e `connect` abre o ADB           |
| 2     | `apps`, `screen`, `push` e `install` funcionam              |
| 3     | `uninstall` remove o pacote e o ícone some da tela          |
| 4     | Limpeza de ícones estáticos de pacotes que não existem mais |

#### Homologados

**Transpeed 6K Ultra (H616)**

| Campo            | Valor                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------- |
| Modelo reportado | `Transpeed_H616`                                                                             |
| Android          | 10                                                                                           |
| Etapa            | 1 a 4 — `list`/`connect`, `apps`/`screen`/`push`/`install`, `uninstall` + limpeza automática |
| Observações      | ADB de rede só existe depois de `tcpip 5555` e volta a cair a cada reboot                    |

**Samsung Galaxy S20**

| Campo    | Valor                     |
| -------- | ------------------------- |
| Modelo   | Galaxy S20                |
| Android  | não registrado            |
| Conexão  | ADB (USB)                 |
| Etapa    | 1 — `list` + `connect`    |
| Launcher | dinâmico (padrão Samsung) |

#### Parcialmente validados

**Android TV original (marca não identificada)**

| Campo                       | Valor                                                 |
| --------------------------- | ----------------------------------------------------- |
| Modelo                      | não identificado (teste feito em outro notebook/rede) |
| Android                     | não registrado                                        |
| Conexão                     | ADB pela rede local                                   |
| Etapa                       | 1 — `list` + `connect`                                |
| `uninstall` remove o ícone? | **Sim** — o ícone sumiu da tela logo após a remoção   |

Esse resultado mostra que o comportamento depende do launcher: em Android TV com launcher dinâmico o ícone acompanha o pacote; em launchers de fabricante com tiles fixos, não.

#### Como homologar um aparelho novo

1. Rode `usb` e `list <ip>` para confirmar a etapa 1.
2. Rode `apps <ip>` e `screen <ip>` para a etapa 2.
3. Instale um APK de teste, remova com `uninstall <ip> <pacote> confirmar` e confira a tela.

### Funções guiadas

A página `/functions.html` concentra as operações de manutenção em um único formulário. Em vez de digitar comandos, você escolhe a função em uma lista e preenche apenas os campos daquela operação:

- Diagnóstico: identificar aparelho, analisar o que pode ser removido, diagnóstico de rede e dispositivos no USB.
- Conexão: conectar, desconectar, parear e ativar o ADB por rede a partir do USB.
- Apps: listar, diagnosticar a certificação do Play, instalar APK, remover e controlar os ícones do launcher.
- Tela e arquivos: capturar a tela e enviar arquivos.
- Sistema: reiniciar a box.

Cada execução entra no painel **Atividade**, no estilo de um log (horário, status, duração e saída), com filtro, cópia da saída e preview das capturas de tela. O alvo pode ser digitado ou escolhido entre os dispositivos já encontrados pela descoberta.

As operações dependem de ADB habilitado e autorizado no dispositivo.

---

## Certificação do Play Store

A Play Store só libera downloads e atualizações quando o Google reconhece o aparelho como certificado. A decisão é tomada no servidor, por **GSF ID + fingerprint do build** — nenhum comando local muda o veredito.

```bash
play 192.168.1.28                    # diagnóstico (somente leitura)
play 192.168.1.28 recheck            # força check-in e abre a Play Store
play 192.168.1.28 recheck limpar     # recheck + limpa os dados da Play Store
```

O diagnóstico mostra o GSF ID, a conta Google, o horário do último check-in, o valor de `uncertified_status`, a data de emissão do veredito, a data de reavaliação, as versões do Play, Play services (com a versão de fábrica embutida na ROM) e Services Framework, o relógio e a rede. A data **Emitido em** vem de `uncertified_status_expiration_time_ms − uncertified_status_expiration_remaining_time_ms`; se ela for anterior ao registro, o Google ainda não aplicou o GSF ID.

O mesmo laudo levanta a identidade do firmware: data de compilação e do kernel, autor (`ro.build.user`/`ro.build.host` ou prop de maintainer), patch de segurança, flags de depuração (SELinux, `debuggable`, `adb.secure`), datas dos `build.prop` e fingerprints de `system`/`vendor`/`product`/`odm`/`boot` comparados ao `ro.build.fingerprint` global. É assim que ele separa uma ROM que assume a própria identidade de um port com o fingerprint global trocado — o caso de muitas TV boxes. O GSF ID é o `android_id` da tabela `main` do `gservices.db` do Google Services Framework — o mesmo valor que a página do Google pede, e **não** o `Settings.Secure.ANDROID_ID`/SSAID. A leitura usa o usuário atual e o caminho oficial (`/data/user/<usuário>/*/*/gservices.db`), com o `Checkin.xml` como fallback.

O `recheck` para a Play Store envia o broadcast de check-in (`android.server.checkin.CHECKIN_NOW`) ao Google Play services — precisa de root — e abre a Play Store na TV. Ele mostra o veredito antes e depois e indica se o servidor o reemitiu: “sem reemissão” significa que o cache de recusa continua o mesmo no `gservices`, e nem check-in nem limpar a Play Store o apagam. A opção `limpar` apaga os dados da Play Store antes (a conta Google permanece).

Para registrar o aparelho:

1. Abra <https://www.google.com/android/uncertified> com a mesma conta Google usada na box.
2. Informe o GSF ID exibido pelo `play`.
3. Rode `play <alvo> recheck` e abra a Play Store.

O GSF ID muda se a box for resetada ou se os dados do Google Play services forem apagados — nesse caso é preciso registrar de novo (limite de 100 IDs por conta). Por isso, não limpe os dados do Google Play services para "resetar" a certificação.

---

## Atualização de firmware (ROM)

O comando procura a ROM na pasta `roms/` e escolhe a rota conforme o **formato** do arquivo. Ele não finge uma instalação que o aparelho não aceita: pacote OTA `.zip` assinado segue pelo Local Update oficial e a instalação é iniciada automaticamente; imagem completa `.img` **não é instalável por ADB** — o comando faz o backup, gera o kit de gravação e termina com **NADA FOI INSTALADO**, sem reportar sucesso. Se a ROM vier dentro de um `.zip` ou `.rar`, o programa lê a imagem diretamente do arquivo, sem extrair nada para o disco.

```bash
update firmware                          # lista as ROMs da pasta
update firmware 192.168.1.28             # estado da box + lista de ROMs
update firmware 192.168.1.28 1           # analisa a ROM nº 1 (não altera nada)
update firmware 192.168.1.28 1 confirmar # executa a rota do formato
```

### Formatos e rotas

| Formato                  | Como é detectado                                                               | Rota                                                             |
| ------------------------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `.zip` OTA               | `META-INF/com/google/android/update-binary`, `updater-script` ou `payload.bin` | **Local Update** (`com.softwinner.update`), automático           |
| `.zip`/`.rar` com `.img` | o arquivo contém uma imagem `.img`; ela é lida em streaming                    | mesma rota do `.img` de dentro                                   |
| `.img` IMAGEWTY          | cabeçalho Allwinner no início do arquivo                                       | **não instalável por ADB**; kit físico (PhoenixCard/PhoenixSuit) |
| `.img` RFSFAT16          | imagem de cartão Allwinner                                                     | **não instalável por ADB**; PhoenixCard (SD)                     |
| outro                    | não reconhecido                                                                | bloqueado                                                        |

Por que a imagem completa não usa o Local Update: o verificador do fabricante chama `android.os.RecoverySystem.verifyPackage`, que só aceita pacote OTA `.zip` com assinatura. Um `.img` não é ZIP; a tela mostra **Package verify failed** mesmo quando a ROM é a correta para a placa. O ADB desta box também não expõe fastboot nem escrita de eMMC, então não existe rota automática para imagem completa: o comando não envia o `.img` e **não retorna sucesso** — ele prepara o kit físico e diz isso diretamente.

### Pasta de ROMs

Coloque as ROMs em `roms/` (criada na primeira execução e fora do Git). São aceitos:

- `.img` — imagem completa Allwinner;
- `.zip` — pacote OTA assinado, instalado pelo Local Update;
- `.zip` ou `.rar` contendo um `.img` — o programa abre o arquivo, encontra a imagem e a analisa **sem extrair**. O `.img` não é gravado no disco, então antivírus que apagam imagens de firmware não atrapalham.

Para `.rar` o programa usa o `UnRAR.exe` do WinRAR ou o `7z.exe` do 7-Zip; se estiverem em outro lugar, defina `TX_UNRAR` ou `TX_7Z`. Na hora da gravação física, PhoenixCard e PhoenixSuit exigem o `.img` solto: extraia com WinRAR/7-Zip e, se o antivírus apagar o arquivo, libere a pasta de extração. O `.rar` original continua servindo como fonte. Para usar outra pasta de ROMs, defina `TX_ROMS_DIR`.

A ROM precisa ser da **mesma placa**: Transpeed H616, SoC `sun50iw9p1`. Uma ROM `Transpeed 6K H6` é de outro SoC (`sun50iw6`) e é bloqueada. O **conteúdo manda mais que o nome**: um arquivo chamado `H616` cuja imagem contém `sun50iw6`/`H6` é bloqueado, e o relatório diz explicitamente que o nome não torna a imagem compatível. A conferência combina cabeçalho Allwinner (`IMAGEWTY`/`RFSFAT16`), strings da imagem (`sun50iw9`, `H616`, `Transpeed_H616`, `ro.fota.version`), tamanho contra o eMMC e, no caso de OTA, a assinatura e o aparelho exigido pelo `updater-script`; o nome do arquivo só entra como pista quando o conteúdo não identifica o SoC.

### O que o comando garante

- **Restaurar firmware compatível com a placa**: valida SoC, modelo, eMMC e espaço livre antes de executar qualquer rota.
- **Remover a identidade do Pixel**: detecta `google/sailfish` na imagem e avisa que essa ROM mantém o fingerprint falso; aponta quando a imagem usa a identidade `Transpeed_H616` original.
- **Recuperar os componentes do sistema**: mostra os arquivos embutidos (`bootloader.fex`, `boot.fex`, `recovery.fex`, `system.fex`, `vendor.fex` etc.).
- **Corrigir propriedades e configurações**: compara a build atual com a da ROM (versão FOTA, data, autor) e, depois do boot, o `play` confirma a identidade efetiva.
- **Identidade legítima do hardware**: mostra o fingerprint da ROM e da box lado a lado.
- **Compatibilidade com GMS e certificação**: lembra que a ROM de terceiro troca o GSF ID, exige novo registro e não garante certificação — o veredito continua sendo do Google.

### Execução

Sem `confirmar`, o comando é somente leitura: analisa a ROM (inclusive SHA-256), inspeciona a box e imprime o plano. Com `confirmar`, as duas rotas começam pelo backup de `bootloader`, `env`, `boot`, `recovery`, `misc`, `vbmeta`, `vbmeta_system` e `vbmeta_vendor` em `backups/<alvo>/<data>/`, com hashes. Se qualquer partição falhar, nada é executado.

**Pacote OTA `.zip`:**

1. Envia o pacote para `/sdcard/Download/` e confere o SHA-256 no aparelho.
2. Abre o **Local Update** e lê a verificação do fabricante via UI Automator.
3. Se o pacote for aceito, toca em **Start install** sozinho (ou detecta o reboot automático) e confirma que a instalação começou.
4. Só retorna sucesso quando a box realmente sai do ADB para aplicar o pacote. Se a tela ficar parada ou aparecer **Package verify failed**, retorna falha e diz que nada foi instalado.

**Imagem completa `.img`:**

1. Faz o backup das partições críticas.
2. Confere o SHA-256 e grava `flash-kit.txt` na pasta do backup, com o procedimento físico completo e os caminhos das ferramentas encontradas no PC.
3. **Não envia o `.img` para a box, não grava o eMMC por ADB e não retorna sucesso**: a saída termina com **NADA FOI INSTALADO** e informa o caminho do kit. O comando não imprime um tutorial de PhoenixCard/PhoenixSuit na tela; esse passo a passo fica no `flash-kit.txt`.

Depois da gravação, o sistema inteiro é substituído e os dados são apagados. O GSF ID muda: registre o novo em <https://www.google.com/android/uncertified> e rode `play` para acompanhar.

O backup não inclui `super`/dados do usuário. Ele serve para conferência e para restaurar partições pequenas enquanto o ADB ainda responde; se o boot quebrar, o caminho de recuperação é o modo FEL/PhoenixSuit ou o cartão SD (PhoenixCard), não o ADB.

> Nenhuma ROM de terceiro é licenciada pelo Google. A atualização pode restaurar a identidade e os componentes originais, mas a certificação do Play continua dependendo do servidor.

---

## Atualização online do firmware (`update ota`)

Força o próprio aparelho a checar no servidor do fabricante se existe atualização, usando o serviço de atualização embutido (`com.softwinner.update` → `OtaService`). O serviço só pode ser iniciado pelo app do fabricante (uid 1000), então o comando usa root (`su 0`).

```bash
update ota 192.168.1.28              # força a checagem e relata o resultado
update ota 192.168.1.28 confirmar    # baixa e instala se o fabricante oferecer pacote
```

Sem `confirmar` o comando é somente leitura: inspeciona o aparelho (modelo, build, URL OTA, updater instalado), testa o canal do fabricante (DNS e porta) e dispara a checagem, lendo o log do serviço. Com `confirmar`, se houver pacote oferecido ele é baixado e a instalação é iniciada (o aparelho sai do ADB e reinicia para aplicar).

O comando não finge que atualizou. Se o canal oficial estiver fora do ar, ele diz exatamente o motivo, verificado na hora:

- **Domínio morto (NXDOMAIN)** — o servidor de atualização não resolve mais no DNS;
- **Porta recusada** — o servidor responde no DNS, mas a porta está fechada;
- **Cleartext bloqueado** — o Android 10 se recusa a fazer HTTP sem TLS e o updater não usa HTTPS.

Nos três casos a resposta termina com **NENHUMA ATUALIZAÇÃO DISPONÍVEL** e `ok: false` — não é falha do comando, é o canal do fabricante que não existe mais. Quando isso acontece, a atualização do firmware passa a ser por ROM local (`update firmware`).

---

## Buscar firmware na internet

O `scan firmware` descobre qual é o hardware real da box e procura ROMs para esse modelo na internet. Ele não usa o fingerprint global (`google/sailfish`) como identidade: modelo, placa e SoC vêm das propriedades de fábrica (`ro.product.*`, `ro.boot.hardware`, `ro.fota.*`), como no `list` e no `play`.

```bash
scan firmware 192.168.1.28       # mostra os 3 melhores candidatos
scan firmware 192.168.1.28 1     # mostra só o melhor
scan firmware 192.168.1.28 10    # até 10 candidatos
```

### O que o comando lê da box

- Modelo, fabricante, marca, `device`, placa, SoC (`sun50iw9p1`), Android/SDK.
- Build, FOTA, data de compilação, autor, fingerprint global e fingerprints por partição.
- Desvios de identidade detectados pelo `play` (fingerprint de Pixel, `userdebug`, `test-keys`, SELinux permissive).
- Root, Local Update, eMMC, memória e uptime (dados do `list`).
- Status da certificação, GSF ID e data do veredito.
- Canal oficial declarado em `ro.product.otaupdateurl` (no Transpeed, `http://ota.szhxws.com/Update`) e o OEM (`ro.fota.oem`).

### Como a busca funciona

1. Monta consultas com o modelo e o SoC, por exemplo `Transpeed H616 Android 10 firmware download`, e uma segunda consulta com o domínio do OEM.
2. Usa a busca HTML do DuckDuckGo, sem chave de API. Se o provedor limitar as consultas diretas (HTTP 202), lê a mesma busca pelo leitor `r.jina.ai`; se ainda assim não vier nada, tenta o Bing. O relatório informa qual caminho foi usado.
3. Lê as páginas dos candidatos e extrai nome de arquivo, data, Android, SoC, links de download (MEGA, Google Drive, MediaFire, Yandex) e a data de publicação.
4. Abre o link de download (pasta do Yandex, Drive, MediaFire etc.) e lê os nomes reais dos arquivos. É assim que o scan percebe quando a página anuncia uma placa, mas o link aponta para outra linha: o caso conhecido é “Transpeed 6K H616” cujos arquivos são todos `Transpeed_6K_*` de 2020, build H6 (`sun50iw6p1`).
5. Descarta placas incompatíveis: página que aponta H6 (`sun50iw6`) não entra na recomendação. H616/H618 (`sun50iw9`) é compatível, mas se os arquivos do link forem de outra linha (ex.: `Transpeed_6K` sem H616 no nome), o candidato é rebaixado para “não confirmado” e o scan não o apresenta como a melhor ROM.
6. Ranqueia por placa, modelo Transpeed citado, Android igual ao da box, presença de arquivo/link, data declarada e origem oficial.
7. Quando a data do título é ambígua (`08-10-2020`: 8 de outubro ou 10 de agosto), ela é exibida com o aviso e não é usada para afirmar que a ROM é mais antiga ou mais nova que a build instalada.
8. Só chama de “Melhor ROM encontrada” quando a placa está confirmada; caso contrário a seção vira “Nenhuma ROM confirmada” e o resultado é tratado como pista. Candidato sem link de download utilizável não entra na recomendação.

### Oficial x terceiro

A classificação é feita pela **origem do resultado**, não por uma assinatura:

- **OFICIAL**: domínio do fabricante/OEM (`szhxws.com`, `transpeed`, `allwinner`, `softwinner`).
- **TERCEIRO**: blog, fórum ou espelho de arquivo (XDA, 4PDA, AndroidPC.tv, China Gadgets Reviews, MEGA, Google Drive, MediaFire etc.). O arquivo pode ser o original da fábrica, mas a distribuição não é do fabricante.
- **INDETERMINADO**: origem não reconhecida.

> A busca não verifica a assinatura criptográfica do firmware. Por isso o comando não baixa nem instala nada: ele só recomenda. Depois de baixar o arquivo para `roms/`, o `update firmware` confere cabeçalho, SoC, identidade, assinatura (no caso de OTA) e SHA-256 antes de qualquer rota.

### Limitações

- A fonte oficial pode estar fora do ar ou bloquear acesso fora da rede da box. Nesse caso o relatório mostra o canal declarado e orienta o suporte do OEM.
- Uma página pode anunciar uma versão mais nova do que a build instalada sem realmente hospedar o arquivo; o ranking reduz a nota de páginas sem link direto e marca a data como "não declarada" quando ela não aparece.
- A placa só é confirmada quando o nome do arquivo no link diz H616/H618; páginas sem nome de arquivo ficam como "não confirmadas". O veredito final é sempre o do `update firmware`, que lê o SoC de dentro do arquivo.
- O resultado depende do que está indexado no DuckDuckGo. Se todos os caminhos de busca falharem, o relatório imprime uma consulta manual pronta.
- A consulta via `r.jina.ai` é um serviço de leitura de terceiros e tem limite de uso anônimo; só o texto da busca (modelo e SoC) sai para esse serviço, nenhum dado da box.

---

## Descoberta de dispositivos

A descoberta procura identificar aparelhos disponíveis na rede local usando diferentes protocolos e sinais.

O processo considera:

- Hosts já conhecidos.
- Dispositivos listados pelo ADB.
- Serviços mDNS.
- SSDP / UPnP.
- Serviços Cast, Android TV Remote e AirPlay.
- Cache ARP.
- Varredura TCP da sub-rede principal.
- Informações obtidas por HTTP, DNS reverso e TTL, quando disponíveis.

Os resultados são agrupados e classificados com base nas evidências encontradas.

A API de dispositivos combina as informações da descoberta com os aparelhos ADB conectados por USB.

---

## Agent com IA — planejado

A evolução do projeto é tornar a aplicação **inteligente**, permitindo que o usuário converse com o dispositivo de maneira mais natural.

Em vez de depender exclusivamente de comandos técnicos, a intenção é desenvolver um agente capaz de interpretar solicitações, entender o contexto do aparelho e executar operações compatíveis com as permissões disponíveis.

**Importante:** esse recurso é apenas um roadmap. A estrutura atual do projeto é composta por descoberta de dispositivos, terminal ADB e operações de manutenção. Não há integração com IA implementada nesta versão.

---

## Estrutura do projeto

A organização é modular: servidor, funcionalidades centrais, descoberta, ADB e interface web ficam separados.

```text
src/
├── server.ts                 # Inicialização do Express e montagem das rotas
├── capabilities.ts           # Mapa de capacidades da aplicação
│
├── core/
│   ├── settings.ts            # Configurações gerais, porta, host e diretórios
│   ├── log.ts                 # Barramento de logs e eventos SSE
│   ├── routes.ts              # Rotas centrais de API
│   ├── security.ts            # Verificação de requisições locais
│   ├── config-store.ts        # Persistência das configurações
│   ├── host-cache.ts          # Cache de dispositivos conhecidos
│   ├── network.ts             # Interfaces, ARP, DNS, TTL e portas
│   ├── wol.ts                 # Wake-on-LAN
│   └── http.ts / xml.ts /
│       text.ts / time.ts      # Utilitários
│
├── discovery/
│   ├── scan.ts                # Orquestração da descoberta
│   ├── identify.ts            # Identificação e classificação
│   ├── models.ts
│   ├── ports.ts
│   ├── types.ts
│   ├── protocols/             # mDNS, SSDP, AirPlay e Cast
│   └── routes.ts              # Endpoints da descoberta
│
└── adb/
    ├── analyze.ts             # Classificação de pacotes seguros para remoção
    ├── play.ts                # Diagnóstico e recheck da certificação do Play
    ├── client.ts              # Cliente ADB e resolução de alvos
    ├── ops.ts                 # Operações de manutenção
    ├── keepalive.ts           # Reconexão e monitoramento
    └── routes.ts              # Comandos, transferências e capturas

firmware/
├── update.ts                  # ROMs, classificação OTA/imagem, backup e kit físico
└── scan.ts                    # hardware + busca na internet + ranking e origem da ROM

roms/                          # ROMs .img e .zip (fora do Git)
backups/                       # backups das partições (fora do Git)

public/
├── discovery.html             # Descoberta e terminal (página inicial)
├── functions.html             # Funções guiadas com histórico de execuções
├── commands.html              # Referência de comandos
├── settings.html              # Configurações
└── js/
    ├── common.js
    ├── capabilities.js
    ├── functions.js
    └── discovery.js
```

A estrutura acima representa os módulos documentados. Arquivos adicionais podem existir no repositório.

---

## Rede e segurança

O servidor utiliza a porta `3000` por padrão e escuta em `0.0.0.0` para permitir que as páginas sejam acessadas pela rede local.

As regras de acesso atuais são:

- As rotas `/api/*` são restritas a requisições locais (o próprio computador que executa o servidor).
- As páginas estáticas podem ser abertas por outros dispositivos da rede, mas as chamadas de API feitas por eles recebem `403`.
- O terminal e as operações de manutenção dependem do ADB habilitado e autorizado no aparelho.

**Atenção:** não exponha o servidor diretamente à internet. A configuração foi pensada para uso local em uma rede confiável.

---

## Limitações conhecidas

- Não existe um método universal para identificar toda TV Box apenas pelo endereço IP.
- Dispositivos desligados, em outra sub-rede ou sem serviços de descoberta ativos podem não aparecer.
- A descoberta depende dos protocolos e serviços disponibilizados pela firmware.
- Alguns aparelhos não anunciam um nome na rede; MACs privados/aleatórios também impedem identificar o fabricante pelo endereço. Nesses casos, o nome pode estar disponível apenas na lista de clientes DHCP do roteador ou nas configurações do próprio aparelho.
- O ADB exige autorização no aparelho antes de permitir operações.
- Algumas fabricantes bloqueiam ou modificam opções de desenvolvedor e depuração.
- A API é restrita ao computador que executa o servidor; outros dispositivos da LAN conseguem abrir as páginas, mas não chamar a API.
- O Agent com IA ainda não está implementado.

Se a firmware bloquear as opções de desenvolvedor, pode ser necessário utilizar um menu de engenharia ou ferramentas específicas do fabricante.

---

## Tecnologias

- **Node.js**
- **TypeScript**
- **Express**
- **Android Debug Bridge (ADB)**
- **HTML, CSS e JavaScript**
- **Protocolos de descoberta de rede:** mDNS, SSDP / UPnP e outros

---

## Contribuindo

Contribuições, testes em diferentes modelos de TV Box e relatos de compatibilidade são bem-vindos.

Para contribuir:

1. Faça um fork do repositório.
2. Crie uma branch para sua alteração.
3. Implemente e teste a mudança.
4. Envie um Pull Request explicando o que foi alterado e como testar.

Ao reportar um problema, inclua, sempre que possível:

- Modelo da TV Box.
- Versão do Android e firmware.
- Tipo de conexão (Wi-Fi, Ethernet ou USB).
- Logs e mensagens de erro relevantes.

---

## Licença

Consulte o arquivo `LICENSE` do repositório para informações sobre os termos de uso e distribuição.
