#define MyAppName "PilotPaper V2"
#define MyAppVersion "2.0.0-preview"
#define MyAppPublisher "PilotPaper"
#define MyAppExeName "PilotPaper-V2.exe"

[Setup]
AppId={{23F68AC7-2057-49D5-81D5-AD2C49B1AA82}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\PilotPaper\V2
DefaultGroupName=PilotPaper V2
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\desktop-output-v2
OutputBaseFilename=PilotPaper-V2-Setup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\{#MyAppExeName}
CloseApplications=yes
RestartApplications=no

; Updates replace only the application payload. User secrets and the Windows-protected
; geometry credential stored at the V2 root are intentionally preserved.
[InstallDelete]
Type: filesandordirs; Name: "{app}\app\current"
Type: filesandordirs; Name: "{app}\.pilotpaper-runtime-v2"

[Files]
Source: "..\desktop-stage-v2\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autodesktop}\PilotPaper V2"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"
Name: "{group}\PilotPaper V2"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Lancer PilotPaper V2"; Flags: nowait postinstall skipifsilent
