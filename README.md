# SIGMA-GCM

Sistema web e aplicativo Android do **SIGMA-GCM**, construído com React, TypeScript, Vite, Express e Firebase, com suporte a autenticação, biometria/WebAuthn, mapas, relatórios operacionais, notificações e recursos de IA.

## Visão geral

O projeto possui uma arquitetura híbrida:

- **Frontend:** React 19 + TypeScript + Vite.
- **Backend:** Node.js + Express + TypeScript.
- **Banco e serviços:** Firebase Authentication, Firestore e Firebase Storage.
- **Autenticação biométrica:** WebAuthn com `@simplewebauthn/browser` e `@simplewebauthn/server`.
- **Aplicativo Android:** Capacitor.
- **Mapas:** Google Maps e Leaflet.
- **IA:** Google Gemini, acessado pelo backend.
- **Arquivos e relatórios:** geração de PDFs, armazenamento e envio por e-mail.
- **Segurança:** regras do Firestore/Storage, autenticação Firebase e tokens JWT em fluxos específicos.

## Estrutura principal

```text
SIGMA-GCM/
├── android/                 # Projeto Android/Capacitor
├── assets/                  # Recursos estáticos
├── public/                  # Arquivos públicos
├── resources/               # Recursos do aplicativo
├── src/
│   ├── components/          # Componentes React
│   ├── lib/                 # Serviços e utilitários do frontend
│   ├── App.tsx              # Aplicação principal
│   ├── firebase.ts          # Configuração Firebase no cliente
│   ├── main.tsx             # Entrada do React
│   └── types.ts             # Tipos da aplicação
├── server/
│   ├── lib/                 # Serviços do backend
│   └── routes/              # Rotas da API
├── server.ts                # Servidor Express + Vite
├── firestore.rules          # Regras de segurança do Firestore
├── storage.rules             # Regras de segurança do Storage
├── firebase.json             # Configuração do Firebase
├── capacitor.config.ts       # Configuração do aplicativo Android
├── package.json
└── README.md
```

## Principais funcionalidades

### Autenticação

O backend implementa diferentes mecanismos de autenticação, incluindo:

- Firebase Authentication;
- autenticação biométrica/WebAuthn;
- Firebase Custom Token;
- JWT próprio do servidor em fluxos legados/específicos;
- controle de tentativas de autenticação e bloqueio temporário;
- registro de auditoria dos logins.

O fluxo WebAuthn está implementado no `server.ts`, utilizando desafios temporários e credenciais armazenadas no Firestore.

> **Importante:** desafios WebAuthn são mantidos atualmente em memória. Para ambientes com múltiplas instâncias do servidor, recomenda-se utilizar Redis ou outro armazenamento compartilhado.

### Gestão operacional

O sistema possui rotas específicas para recursos administrativos e operacionais, incluindo:

- usuários e perfis;
- notificações;
- registros e relatórios de turno;
- cadastro/registro;
- integração com Google WebAuthn;
- geração de conteúdo com Gemini.

### Mapas e localização

O frontend utiliza Google Maps e Leaflet para recursos de localização e acompanhamento operacional.

### Relatórios

O projeto inclui recursos para:

- geração de relatórios;
- exportação em PDF;
- tabelas;
- envio por e-mail;
- integração opcional com IA para sumarização.

## Tecnologias

| Tecnologia | Uso |
|---|---|
| React | Interface |
| TypeScript | Linguagem principal |
| Vite | Build e desenvolvimento |
| Express | API/backend |
| Firebase Auth | Autenticação |
| Firestore | Banco de dados |
| Firebase Storage | Armazenamento |
| WebAuthn | Autenticação biométrica |
| Capacitor | Aplicativo Android |
| Google Maps | Mapas |
| Leaflet | Mapas e geolocalização |
| Gemini | Recursos de IA |
| Tailwind CSS | Estilização |
| Vitest | Testes |

## Requisitos

- Node.js
- npm
- Para Android: Android Studio + SDK Android
- Para recursos Firebase: projeto Firebase configurado
- Para Gemini: chave da API Gemini
- Para Google Maps: chave da API Google Maps, quando utilizada

## Configuração

Instale as dependências:

```bash
npm install
```

Crie seu arquivo de ambiente a partir do exemplo:

```bash
cp .env.example .env
```

No Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Configure as variáveis necessárias no ambiente de execução. **Nunca publique chaves privadas, senhas, tokens ou credenciais de serviço no Git.**

As configurações de produção podem exigir, entre outras, variáveis relacionadas a:

- `GEMINI_API_KEY`
- `APP_URL`
- `JWT_SECRET`
- `CORS_EXTRA_ORIGINS`
- credenciais/configuração do Firebase Admin
- configurações de e-mail
- configurações de serviços externos

Consulte os arquivos do backend para identificar as variáveis efetivamente utilizadas pelo ambiente.

## Desenvolvimento

Execute o servidor em modo de desenvolvimento:

```bash
npm run dev
```

O projeto utiliza Express com middleware do Vite durante o desenvolvimento.

Também existe o comando:

```bash
npm start
```

## Build web

Para gerar a versão de produção:

```bash
npm run build
```

Para visualizar o build localmente:

```bash
npm run preview
```

## Android

O aplicativo utiliza Capacitor.

Sincronize o projeto Android:

```bash
npm run cap:sync:android
```

Abra no Android Studio:

```bash
npm run cap:open:android
```

Para gerar um APK de debug no Windows:

```bash
npm run android:apk
```

O identificador do aplicativo é:

```text
com.sigmagcm.app
```

## Testes e verificação

Verificação de tipos:

```bash
npm run lint
```

Testes:

```bash
npm test
```

Testes em modo observação:

```bash
npm run test:watch
```

## Backend e API

O servidor Express é iniciado por `server.ts`.

Entre os endpoints relacionados à autenticação biométrica estão:

```text
GET  /api/webauthn/register-options
POST /api/webauthn/register-verify
GET  /api/webauthn/login-options
POST /api/webauthn/login-verify
POST /api/audit-login
```

O backend também registra módulos de API para Gemini, usuários administrativos, notificações, registros/cadastros e relatórios de turno.

## Segurança

Alguns pontos importantes da implementação atual:

1. O segredo JWT deve ser definido por variável de ambiente em produção.
2. Não utilize o valor padrão de `JWT_SECRET` em ambiente de produção.
3. Credenciais WebAuthn devem ser tratadas como dados sensíveis.
4. O armazenamento de desafios WebAuthn em memória não é adequado para múltiplas instâncias sem afinidade de sessão.
5. As regras `firestore.rules` e `storage.rules` fazem parte da camada de autorização e devem ser revisadas junto com o backend.
6. Chaves de APIs e credenciais de serviços devem permanecer fora do código-fonte.
7. As origens CORS de produção devem ser restritas às origens realmente utilizadas pelo sistema.
8. Tokens de autenticação não devem ser registrados em logs.

## Firebase

O projeto contém configuração para:

- Firestore;
- Storage;
- Firebase Authentication;
- Firebase Hosting.

As regras de segurança estão em:

```text
firestore.rules
storage.rules
```

A configuração do Hosting está em:

```text
firebase.json
```

## Deploy

O projeto pode ser executado em ambientes que suportem Node.js e também possui configuração relacionada ao Firebase Hosting.

Para um deploy de produção, recomenda-se:

1. configurar todas as variáveis de ambiente;
2. configurar corretamente o Firebase Admin;
3. revisar CORS;
4. revisar as regras do Firestore e Storage;
5. definir um `JWT_SECRET` forte e exclusivo;
6. configurar as credenciais de APIs externas;
7. executar o build;
8. validar a autenticação e os fluxos de autorização;
9. testar o aplicativo Android, quando aplicável.

## Licença

A licença do projeto não está definida neste README. Consulte o proprietário do repositório antes de redistribuir ou utilizar o código em outro projeto.

## Status

Este README documenta a estrutura e os principais recursos identificados no código atual do repositório. À medida que novas funcionalidades forem adicionadas, a documentação deve ser atualizada junto com o código.
