#define MyAppName "DoctorOps"
#define MyAppPublisher "HIGHSKY.REC"
#define MyAppExeName "DoctorOps"
#define MyDataDir "{localappdata}\DoctorOps"

[Setup]
AppId={{D6C4B0A2-5E3F-4A98-8B71-2F9C6E4D1A38}
AppName={#MyAppName}
AppVersion={#AppVersion}
AppVerName={#MyAppName} {#AppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\DoctorOps
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
DisableWelcomePage=no
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=DoctorOps-{#AppVersion}-setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayName={#MyAppName}
UninstallDisplayIcon={app}\runtime\node.exe
CloseApplications=no
RestartApplications=no
#if FileExists(IconFile)
SetupIconFile={#IconFile}
#endif
; A box é acessada pela rede; o Node é embutido, não usa PATH do sistema.

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
Name: "desktopicon"; Description: "Criar atalho na área de trabalho"; GroupDescription: "Atalhos:"; Flags: unchecked

[InstallDelete]
Type: filesandordirs; Name: "{app}\app"

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\{#MyAppExeName}"; Filename: "{app}\runtime\node.exe"; Parameters: """{app}\app\dist\server.js"""; WorkingDir: "{app}"; Comment: "Abrir o DoctorOps"; IconFilename: "{app}\app.ico"
Name: "{autodesktop}\{#MyAppExeName}"; Filename: "{app}\runtime\node.exe"; Parameters: """{app}\app\dist\server.js"""; WorkingDir: "{app}"; Comment: "Abrir o DoctorOps"; IconFilename: "{app}\app.ico"; Tasks: desktopicon
Name: "{group}\Pasta de dados (ROMs, backups, capturas)"; Filename: "{win}\explorer.exe"; Parameters: """{#MyDataDir}"""
Name: "{group}\Desinstalar {#MyAppName}"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\runtime\node.exe"; Parameters: """{app}\app\dist\server.js"""; WorkingDir: "{app}"; Description: "Abrir o {#MyAppName} agora"; Flags: nowait postinstall skipifsilent
