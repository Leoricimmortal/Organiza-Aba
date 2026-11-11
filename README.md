# Organiza Aba

Extensão para Google Chrome (e outros navegadores baseados em Chromium, como Edge) que fecha automaticamente abas de domínios configurados, após um tempo definido por você.

## O que ela faz

- Você cadastra até **4 domínios** (ex.: `retaguarda.chatpro.com.br`).
- Para cada domínio, define um tempo (segundos, minutos ou horas).
- Toda aba aberta nesse domínio ganha seu próprio cronômetro individual.
- Quando o tempo se esgota, a aba é fechada automaticamente — sem afetar abas de outros domínios ou abas do mesmo domínio que foram abertas em horários diferentes.
- A extensão continua funcionando mesmo com o popup fechado, o navegador reiniciado ou o computador desligado e ligado novamente (as regras e os temporizadores ficam salvos).

## Como funciona (resumo técnico)

- **`background.js`** é um *Service Worker* (Manifest V3) que:
  - Observa `chrome.tabs.onUpdated` / `onCreated` / `onRemoved` para saber quando uma aba passa a pertencer (ou deixa de pertencer) a um domínio monitorado.
  - Usa `chrome.alarms` para agendar o fechamento de cada aba de forma persistente — o alarme sobrevive mesmo se o Service Worker for encerrado por inatividade.
  - Antes de fechar qualquer aba, revalida: se a regra ainda está ativa, se o domínio da aba não mudou, e se a aba não está fixada (quando a opção "Não fechar abas fixadas" estiver ligada).
  - Guarda tudo em `chrome.storage.local`: regras, configurações, abas monitoradas e um pequeno histórico.
- **`popup.html` / `popup.css` / `popup.js`** formam a interface: lista de domínios, formulário de adicionar/editar, contador de abas monitoradas e tela de configurações com o histórico recente.

### Observação sobre precisão de tempos muito curtos

O Chrome define um intervalo mínimo para `chrome.alarms` em extensões publicadas na Chrome Web Store (normalmente 30 segundos). **Extensões carregadas em modo desenvolvedor (sem compactação)** — que é como esta extensão é distribuída aqui — não têm essa restrição, então tempos como "10 segundos" funcionam com boa precisão. Se um dia você publicar a extensão na Chrome Web Store, tempos abaixo de ~30 segundos podem demorar um pouco mais para disparar.

## Como instalar no Chrome

1. Abra `chrome://extensions/`.
2. Ative o **"Modo do desenvolvedor"** (canto superior direito).
3. Clique em **"Carregar sem compactação"**.
4. Selecione a pasta `organiza-aba/`.
5. (Opcional) Clique no ícone de pino na barra de ferramentas para fixar a extensão.

## Como configurar um domínio

1. Clique no ícone da extensão.
2. Clique em **"+ Adicionar domínio"**.
3. Preencha:
   - **Domínio**: pode colar a URL completa (`https://exemplo.com/pagina`) ou só o domínio (`exemplo.com`) — a extensão extrai o hostname automaticamente.
   - **Tempo** e **Unidade** (segundos, minutos ou horas).
   - **Regra ativa**: liga/desliga a regra já na criação.
4. Clique em **Salvar**.

Abas já abertas naquele domínio entram no monitoramento imediatamente; novas abas do mesmo domínio também são detectadas automaticamente.

## Como alterar ou excluir uma regra

- Na lista principal, cada regra tem os botões **Editar**, **Ativar/Desativar** e **Excluir**.
- **Editar**: muda domínio, tempo, unidade ou status. Os temporizadores das abas relacionadas são reiniciados com o novo tempo.
- **Desativar**: para o monitoramento sem apagar a regra; as abas não são fechadas automaticamente enquanto estiver desativada.
- **Excluir**: remove a regra e para o monitoramento; as abas abertas continuam abertas normalmente.

## Configurações gerais

Acessíveis pelo ícone de engrenagem (⚙️) no topo do popup:

- **Não fechar abas fixadas**: abas marcadas como fixadas no Chrome são ignoradas.
- **Mostrar aviso antes de fechar**: exibe uma notificação do sistema pouco antes do fechamento.
- **Mostrar contador de abas**: exibe quantas abas estão sendo monitoradas e o tempo até o próximo fechamento.

A tela de configurações também mostra um **histórico recente** (últimas abas fechadas automaticamente).

## Estrutura do projeto

```
organiza-aba/
├── manifest.json      # Configuração da extensão (Manifest V3)
├── popup.html          # Interface do popup
├── popup.css           # Estilos do popup
├── popup.js            # Lógica da interface (lista, formulário, configurações)
├── background.js       # Service worker: regras, temporizadores, fechamento de abas
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## Permissões utilizadas

- **`tabs`**: necessária para ler a URL das abas, identificar o domínio, fechar abas e verificar se estão fixadas.
- **`storage`**: para salvar regras, configurações, abas monitoradas e histórico em `chrome.storage.local`, garantindo que tudo sobreviva a reinícios.
- **`alarms`**: para agendar o fechamento de cada aba de forma persistente, mesmo se o Service Worker for descarregado por inatividade.
- **`notifications`**: usada apenas quando a opção "Mostrar aviso antes de fechar" está ativada.
- **`host_permissions: <all_urls>`**: como os domínios monitorados são definidos livremente por você, a extensão precisa poder ler a URL de qualquer aba para saber se ela corresponde a alguma regra cadastrada. Nenhum dado de navegação é enviado para fora do seu navegador — tudo fica em `chrome.storage.local`.

## Como testar

Roteiro sugerido (baseado no cenário obrigatório do projeto):

1. Cadastre `retaguarda.chatpro.com.br` com **10 segundos**.
2. Abra duas URLs diferentes desse domínio, por exemplo:
   - `https://retaguarda.chatpro.com.br/pg_chat_usuarios.php?form=1&edita=chatpro-4a7b54ab58`
   - `https://retaguarda.chatpro.com.br/pg_v2_empresa.php?id=d630dc00-817f-4ae0-a91e-7e08015a0346`
   - Ambas devem ser identificadas como o mesmo domínio (verifique o contador de abas no popup).
3. Aguarde 10 segundos — as duas abas devem fechar.
4. Abra uma aba de outro domínio (ex.: `google.com`) e confirme que ela permanece aberta.

Outros cenários para validar:

- Abrir duas abas do mesmo domínio em momentos diferentes → cada uma fecha no seu próprio horário.
- Navegar dentro do mesmo domínio (trocar de página) → o cronômetro não deve reiniciar.
- Navegar para outro domínio e depois voltar → deve reiniciar o monitoramento ao voltar.
- Desativar uma regra → abas monitoradas por ela param de ser fechadas.
- Excluir uma regra → o mesmo efeito, mas a regra some da lista.
- Fixar uma aba (com a opção "Não fechar abas fixadas" ligada) → ela não deve ser fechada.
- Reiniciar o navegador com regras ativas e abas abertas → o monitoramento deve continuar.
- Cadastrar 4 domínios e tentar adicionar um quinto → deve ser bloqueado com mensagem de erro.
- Editar o tempo de uma regra existente → as abas relacionadas devem usar o novo tempo a partir da edição.

## Limitações conhecidas (primeira versão)

- O "aviso antes de fechar" mostra uma notificação do sistema, mas ainda não oferece um botão para cancelar o fechamento daquela aba específica — fica como evolução futura, conforme previsto no escopo do projeto.
- O histórico guarda apenas as últimas 20 abas fechadas, para não consumir armazenamento desnecessário.
