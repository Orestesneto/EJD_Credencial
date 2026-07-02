# Versao Para Celular

Aplicativo Android do **EJD Credenciamento** usando Capacitor.

O app abre a versao de producao:

```text
https://ejd-credenciamento.vercel.app
```

## Requisitos

- Node.js 18+
- Android Studio
- JDK configurado pelo Android Studio

## Instalar Dependencias

```bash
npm install
```

## Abrir No Android Studio

```bash
npm run sync
npm run open
```

Depois, selecione um emulador ou celular Android conectado e execute pelo Android Studio.

## Rodar Direto No Android

```bash
npm run run:android
```

## Gerar APK Debug

```bash
npm run build:android
```

O APK debug fica em:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

No Windows, tambem pode rodar diretamente:

```powershell
cd android
.\gradlew.bat assembleDebug
```

## Observacoes

- Esta versao depende da internet, porque usa o deploy de producao.
- As credenciais e dados continuam no backend da Vercel/Neon.
- Sempre que o site de producao for atualizado, o app carrega a versao atual automaticamente.
