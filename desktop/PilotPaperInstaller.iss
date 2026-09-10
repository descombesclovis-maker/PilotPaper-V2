#define MyAppName "PilotPaper"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "PilotPaper"
#define MyAppExeName "PilotPaper.exe"

[Setup]
AppId={{D9162D40-8F77-44A9-9D67-9F181A6B27CC}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\PilotPaper
DefaultGroupName=PilotPaper
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\desktop-output
OutputBaseFilename=PilotPaper-Setup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\{#MyAppExeName}
CloseApplications=yes
RestartApplications=no

[Files]
Source: "..\desktop-stage\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autodesktop}\PilotPaper"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"
Name: "{group}\PilotPaper"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Lancer PilotPaper"; Flags: nowait postinstall skipifsilent
