#define MyAppName "PilotPaper V1"
#define MyAppVersion "1.1.0-image2"
#define MyAppPublisher "PilotPaper"
#define MyAppExeName "PilotPaper-V1.exe"

[Setup]
AppId={{6CA73972-969D-46B5-BC85-2F5AA1B27411}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\PilotPaper\V1
DefaultGroupName=PilotPaper V1
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\desktop-output
OutputBaseFilename=PilotPaper-V1-Setup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\{#MyAppExeName}
CloseApplications=yes
RestartApplications=no

; Remove the superseded V1 application payload and Geometry Engine before copying
; the new direct Image-2 runtime. Root .dev.vars is intentionally preserved.
[InstallDelete]
Type: filesandordirs; Name: "{app}\app\current"
Type: filesandordirs; Name: "{app}\geometry-engine"
Type: files; Name: "{app}\.pilotpaper-runtime\PilotPaper-V1-Update.exe"

[Files]
Source: "..\desktop-stage\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autodesktop}\PilotPaper V1"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"
Name: "{group}\PilotPaper V1"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Lancer PilotPaper V1"; Flags: nowait postinstall skipifsilent
