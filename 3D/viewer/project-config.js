// Configuração compartilhada dos projetos; nenhum módulo técnico é importado aqui.
export const DISCIPLINE_LABELS = {
    "IFC_ELE": "Instalações elétricas",
    "IFC_LOG": "Cabeamento estruturado",
    "IFC_HID": "Instalações hidráulicas",
    "IFC_ALI": "Alimentadores elétricos",
    "IFC_EST": "Estrutura",
    "IFC_PLU": "Águas pluviais",
    "IFC_SAN": "Instalações sanitárias",
    "IFC_INC": "Prevenção e combate a incêndio",
    "IFC_FOT": "Sistema fotovoltaico",
    "IFC_CLI": "Climatização",
    "IFC_SPDA": "SPDA",
    "IFC_SUB": "Subestação",
    "IFC_ILUX": "Iluminação externa",
    "IFC_ILU": "Iluminação",
    "IFC_TEF": "Telefonia",
    "IFC_SDAI": "Detecção e alarme de incêndio",
    "IFC_GLP": "GLP",
    "IFC_IRRI": "Irrigação",
    "IFC_SOM": "Sonorização",
    "IFC_ARQ": "Arquitetura",
    "IFC_EXA": "Exaustão",
    "IFC_ECX": "Equipamentos especiais",
    "IFC_ITM": "Instalações mecânicas",
    "IFC_LOG_TEF": "Cabeamento estruturado e telefonia",
    "IFC_SAN_PLU": "Instalações sanitárias e águas pluviais",
    "IFC_EST_PP": "Estrutura do prédio principal",
    "IFC_EST_SQD": "Estrutura da subestação e quadros",
    "IFC_EST_SUB": "Estrutura da subestação",
    "IFC_EST_CT": "Estrutura da central técnica",
    "IFC_EST_MR": "Estrutura do módulo de resíduos",
    "IFC_EST_MRC": "Estrutura do módulo de resíduos coberto",
    "IFC_EST_EMT": "Estrutura do edifício multiuso",
    "IFC_EMT_ESC": "Edifício multiuso — escola",
    "IFC_EMT_COB": "Edifício multiuso — cobertura",
    "IFC_CLI_DUT": "Climatização — dutos",
    "IFC_ELE_T_220": "Elétrica 220 V — tomadas",
    "IFC_ELE_S_220": "Elétrica 220 V — serviços",
    "IFC_ELE_A_220": "Elétrica 220 V — ar-condicionado",
    "IFC_ALI_220": "Alimentadores 220 V",
    "IFC_ALI_380": "Alimentadores 380 V",
    "IFC_ARQ_SESC_GERAL": "Arquitetura geral",
    "IFC_TANQUE": "Tanque",
    "IFC_SDO": "Instalações de drenagem oleosa"
};

// `src` é a única fonte necessária à compatibilização geométrica XKT.
// Cada modelo possui valores comuns e overrides explícitos por contexto de autenticação.
// enabled=false remove o modelo antes do carregamento: o respectivo XKT não é solicitado.
export const PROJECT_CONFIGS = {
    tce: {
        name: "TCE",
        models: {
            IFC_ARQ: {
                src: "/3D/TCE/XKT-ARQ-TCE.xkt",
                label: "Arquitetura",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_ELE_380: {
                src: "/3D/TCE/XKT-ELE-380-TCE.xkt",
                label: "Instalações elétricas — 380 V",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_LOG: {
                src: "/3D/TCE/XKT-LOG-TCE.xkt",
                label: "Cabeamento estruturado",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_PLU: {
                src: "/3D/TCE/XKT-PLU-TCE.xkt",
                label: "Águas pluviais",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_SPDA: {
                src: "/3D/TCE/XKT-SPDA-TCE.xkt",
                label: "SPDA",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_EXA: {
                src: "/3D/TCE/XKT-EXA-TCE.xkt",
                label: "Exaustão",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_EMT_FUND: {
                src: "/3D/TCE/XKT-EMT-TCE-FUNDAÇÃO.xkt",
                label: "Estrutura Metálica - Fundação",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_INC: {
                src: "/3D/TCE/XKT-INC-TCE.xkt",
                label: "Prevenção e combate a incêndio",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_EMT_ESTAC: {
                src: "/3D/TCE/XKT-EMT-TCE-ESTAC.xkt",
                label: "EMT — estacionamento",
                transform: { position: [0, 0, 0] },
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_EST_PP: {
                src: "/3D/TCE/XKT-EST-TCE-PP.xkt",
                label: "Estrutura do prédio principal",
                transform: { position: [0, 0, 0] },
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_FOT: {
                src: "/3D/TCE/XKT-FOT-TCE.xkt",
                label: "Sistema fotovoltaico",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_ALI_220: {
                src: "/3D/TCE/XKT-ALI-220-TCE.xkt",
                label: "Alimentador 220V",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_ALI_380: {
                src: "/3D/TCE/XKT-ALI-380-TCE.xkt",
                label: "Alimentador 380V",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_IRRI: {
                src: "/3D/TCE/XKT-IRRI-TCE.xkt",
                label: "Irrigação",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_SDAI: {
                src: "/3D/TCE/XKT-SDAI-TCE.xkt",
                label: "Sistema de Alarme",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_HID: {
                src: "/3D/TCE/XKT-HID-TCE.xkt",
                label: "Instalações hidráulicas",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_ILUX: {
                src: "/3D/TCE/XKT-ILUX-TCE.xkt",
                label: "Iluminação externa",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_ELE_220_TERREO: {
                src: "/3D/TCE/XKT-ELE-220-TCE-TERREO.xkt",
                label: "Elétrica 220 V — térreo",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_ELE_220_PAV1: {
                src: "/3D/TCE/XKT-ELE-220-TCE-PAV1.xkt",
                label: "Elétrica 220 V — pavimento 1",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_ELE_220_PAV2: {
                src: "/3D/TCE/XKT-ELE-220-TCE-PAV2.xkt",
                label: "Elétrica 220 V — pavimento 2",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_ELE_220_PAV3: {
                src: "/3D/TCE/XKT-ELE-220-TCE-PAV3.xkt",
                label: "Elétrica 220 V — pavimento 3",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_ELE_220_PAV4: {
                src: "/3D/TCE/XKT-ELE-220-TCE-PAV4.xkt",
                label: "Elétrica 220 V — pavimento 4",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_ELE_220_PAV5: {
                src: "/3D/TCE/XKT-ELE-220-TCE-PAV5.xkt",
                label: "Elétrica 220 V — pavimento 5",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_ELE_220_COB: {
                src: "/3D/TCE/XKT-ELE-220-TCE-COB.xkt",
                label: "Elétrica 220 V — cobertura",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_EMT_A: {
                src: "/3D/TCE/XKT-EMT-TCE-A.xkt",
                label: "EMT — A",
                transform: { position: [0, 0, 0] },
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_EMT_B: {
                src: "/3D/TCE/XKT-EMT-TCE-B.xkt",
                label: "EMT — B",
                transform: { position: [0, 0, 0] },
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_EMT_C: {
                src: "/3D/TCE/XKT-EMT-TCE-C.xkt",
                label: "EMT — C",
                transform: { position: [0, 0, 0] },
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_EMT_D: {
                src: "/3D/TCE/XKT-EMT-TCE-D.xkt",
                label: "EMT — D",
                transform: { position: [0, 0, 0] },
                public: { enabled: false },
                authenticated: { enabled: false }
            },
            IFC_EMT_E: {
                src: "/3D/TCE/XKT-EMT-TCE-E.xkt",
                label: "EMT — E",
                transform: { position: [0, 0, 0] },
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_EMT_F: {
                src: "/3D/TCE/XKT-EMT-TCE-F.xkt",
                label: "EMT — F",
                transform: { position: [0, 0, 0] },
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_EMT_G: {
                src: "/3D/TCE/XKT-EMT-TCE-G.xkt",
                label: "EMT — G",
                transform: { position: [0, 0, 0] },
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_EMT_H: {
                src: "/3D/TCE/XKT-EMT-TCE-H.xkt",
                label: "EMT — H",
                transform: { position: [0, 0, 0] },
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_EST_SUB: {
                src: "/3D/TCE/XKT-EST-TCE-SUBESTACAO.xkt",
                label: "EST — SUB",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_EST_GUA_1: {
                src: "/3D/TCE/XKT-EST-TCE-GUARITA01.xkt",
                label: "EST — GUA 1",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_EST_GUA_2: {
                src: "/3D/TCE/XKT-EST-TCE-GUARITA02.xkt",
                label: "EST — GUA 2",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_CLI: {
                src: "/3D/TCE/XKT-CLI-TCE.xkt",
                label: "CLI",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_CLI_DUTOS: {
                src: "/3D/TCE/XKT-CLI-TCE-DUTOS.xkt",
                label: "CLI — DUTOS",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_SAN: {
                src: "/3D/TCE/XKT-SAN-TCE.xkt",
                label: "SAN",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
        }
    },
    iper: {
        name: "IPER",
        models: {
            IFC_ELE: {
                src: "/3D/iper/modelo-01.xkt",
                label: "Instalações elétricas",
                transform: {"position":[0.16,0,-0.19]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_LOG: {
                src: "/3D/iper/modelo-02.xkt",
                label: "Cabeamento estruturado",
                transform: {"position":[0.16,0,-0.19],"rotation":[0,90,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_HID: {
                src: "/3D/iper/modelo-03.xkt",
                label: "Instalações hidráulicas",
                transform: {"position":[0.15,0,13.9],"rotation":[0,90,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_ALI: {
                src: "/3D/iper/modelo-04.xkt",
                label: "Alimentadores elétricos",
                transform: {"position":[0.16,0,-0.17]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_EST: {
                src: "/3D/iper/modelo-05.xkt",
                label: "Estrutura",
                transform: {"position":[-8.789,0.4,22.5]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_ARQ: {
                src: "/3D/iper/modelo-06.xkt",
                label: "Arquitetura",
                transform: {"position":[0.16,0,-0.19],"rotation":[0,90,0]},
                public: { enabled: true },
                authenticated: { enabled: false  }
            },
            IFC_PLU: {
                src: "/3D/iper/modelo-07.xkt",
                label: "Águas pluviais",
                transform: {"position":[0.15,0,-0.19],"rotation":[0,90,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_SAN: {
                src: "/3D/iper/modelo-08.xkt",
                label: "Instalações sanitárias",
                transform: {"position":[0.16,0,-0.19],"rotation":[0,90,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_INC: {
                src: "/3D/iper/modelo-09.xkt",
                label: "Prevenção e combate a incêndio",
                transform: {"position":[0.15,0,13.9],"rotation":[0,90,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_EST_SQD: {
                src: "/3D/iper/modelo-10.xkt",
                label: "Estrutura da subestação e quadros",
                transform: {"position":[18.655,-0.658,-15.615]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_EST_SUB: {
                src: "/3D/iper/modelo-11.xkt",
                label: "Estrutura da subestação",
                transform: {"position":[27.7,-0.58,-22.4],"rotation":[0,-84.1,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_EST_CT: {
                src: "/3D/iper/modelo-12.xkt",
                label: "Estrutura da central técnica",
                transform: {"position":[-15.15,1.44,-16.47],"rotation":[0,90,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_EST_MR: {
                src: "/3D/iper/modelo-13.xkt",
                label: "Estrutura do módulo de resíduos",
                transform: {"position":[35.25,0,20.2],"rotation":[0,90,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_EST_MRC: {
                src: "/3D/iper/modelo-14.xkt",
                label: "Estrutura do módulo de resíduos coberto",
                transform: {"position":[-23.005,0.35,28.88]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_FOT: {
                src: "/3D/iper/modelo-15.xkt",
                label: "Sistema fotovoltaico",
                transform: {"position":[0,0,13.94],"rotation":[0,90,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_EMT_ESC: {
                src: "/3D/iper/modelo-16.xkt",
                label: "Edifício multiuso — escola",
                transform: {"position":[0.14,0.35,-0.15],"rotation":[0,90,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_EMT_COB: {
                src: "/3D/iper/modelo-17.xkt",
                label: "Edifício multiuso — cobertura",
                transform: {"position":[0.14,0,-0.15],"rotation":[0,90,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_CLI: {
                src: "/3D/iper/modelo-18.xkt",
                label: "Climatização",
                transform: {"position":[0.16,0,-0.2],"rotation":[0,90,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_SPDA: {
                src: "/3D/iper/modelo-19.xkt",
                label: "SPDA",
                transform: {"position":[0.2,0,13.94],"rotation":[0,90,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_SUB: {
                src: "/3D/iper/modelo-20.xkt",
                label: "Subestação",
                transform: {"position":[2.74,-0.28,2.65],"rotation":[0,96.1,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_ILUX: {
                src: "/3D/iper/modelo-21.xkt",
                label: "Iluminação externa",
                transform: {"position":[-13.94,0,-0.2]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_TEF: {
                src: "/3D/iper/modelo-22.xkt",
                label: "Telefonia",
                transform: {"position":[0.16,0,-0.19],"rotation":[0,90,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_SDAI: {
                src: "/3D/iper/modelo-23.xkt",
                label: "Detecção e alarme de incêndio",
                transform: {"position":[0.16,0,-0.19]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_GLP: {
                src: "/3D/iper/modelo-24.xkt",
                label: "GLP",
                transform: {"position":[0.16,0,-0.17],"rotation":[0,90,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_IRRI: {
                src: "/3D/iper/modelo-25.xkt",
                label: "Irrigação",
                transform: {"position":[0.15,0,13.9],"rotation":[0,90,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_SOM: {
                src: "/3D/iper/modelo-26.xkt",
                label: "Sonorização",
                transform: {"position":[0.16,0,-0.19],"rotation":[0,90,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
        }
    },
    lacen: {
        name: "LACEN",
        models: {
            IFC_LOG_TEF: {
                src: "/3D/lacen/modelo-01.xkt",
                label: "Cabeamento estruturado e telefonia",
                transform: {"position":[-14.08,0,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_ELE: {
                src: "/3D/lacen/modelo-02.xkt",
                label: "Instalações elétricas",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_SPDA: {
                src: "/3D/lacen/modelo-03.xkt",
                label: "SPDA",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_ECX: {
                src: "/3D/lacen/modelo-04.xkt",
                label: "Equipamentos especiais",
                transform: {"position":[-14.08,0,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_ILUX: {
                src: "/3D/lacen/modelo-05.xkt",
                label: "Iluminação externa",
                transform: {"position":[-14.08,0,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_EST: {
                src: "/3D/lacen/modelo-06.xkt",
                label: "Estrutura",
                transform: {"position":[-62.3,0.4,35.2]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_SAN: {
                src: "/3D/lacen/modelo-07.xkt",
                label: "Instalações sanitárias",
                transform: {"position":[-1,0,-14.1]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_INC: {
                src: "/3D/lacen/modelo-08.xkt",
                label: "Prevenção e combate a incêndio",
                transform: {"position":[-1,0,-14.1]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_HID: {
                src: "/3D/lacen/modelo-09.xkt",
                label: "Instalações hidráulicas",
                transform: {"position":[-1,0,-14.1]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_PLU: {
                src: "/3D/lacen/modelo-10.xkt",
                label: "Águas pluviais",
                transform: {"position":[13.03,0,-14.05]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_GLP: {
                src: "/3D/lacen/modelo-11.xkt",
                label: "GLP",
                transform: {"position":[13.03,0,-14.05]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_EST_SUB: {
                src: "/3D/lacen/modelo-13.xkt",
                label: "Estrutura da subestação",
                transform: {"position":[-41.57,0.4,15.5],"rotation":[0,90,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_CLI_DUT: {
                src: "/3D/lacen/modelo-14.xkt",
                label: "Climatização — dutos",
                transform: {"position":[13,0,0],"rotation":[0,90,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_EXA: {
                src: "/3D/lacen/modelo-15.xkt",
                label: "Exaustão",
                transform: {"position":[13.03,0,-14.05]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_CLI: {
                src: "/3D/lacen/modelo-16.xkt",
                label: "Climatização",
                transform: {"position":[-0.5,0,-14.05]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_EST_CT: {
                src: "/3D/lacen/modelo-17.xkt",
                label: "Estrutura da central técnica",
                transform: {"position":[-54,0,-5.3]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_ALI_220: {
                src: "/3D/lacen/modelo-18.xkt",
                label: "Alimentadores 220 V",
                transform: {"position":[-14.08,0,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_ALI_380: {
                src: "/3D/lacen/modelo-19.xkt",
                label: "Alimentadores 380 V",
                transform: {"position":[-14.08,0,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
        }
    },
    policlinica: {
        name: "Policlínica",
        models: {
            IFC_EST_PP: {
                src: "/3D/policlinica/modelo-01.xkt",
                label: "Estrutura do prédio principal",
                transform: {"position":[-80,0.4,50]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_ELE_T_220: {
                src: "/3D/policlinica/modelo-02.xkt",
                label: "Elétrica 220 V — tomadas",
                transform: {"position":[-78,0,40]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_PLU: {
                src: "/3D/policlinica/modelo-03.xkt",
                label: "Águas pluviais",
                transform: {"position":[-78,0,40]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_HID: {
                src: "/3D/policlinica/modelo-04.xkt",
                label: "Instalações hidráulicas",
                transform: {"position":[-78,0,40],"rotation":[0,-45,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_SAN: {
                src: "/3D/policlinica/modelo-05.xkt",
                label: "Instalações sanitárias",
                transform: {"position":[-78,0,40]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_ELE_S_220: {
                src: "/3D/policlinica/modelo-06.xkt",
                label: "Elétrica 220 V — serviços",
                transform: {"position":[-78,0,40],"rotation":[0,-45,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_ITM: {
                src: "/3D/policlinica/modelo-07.xkt",
                label: "Instalações mecânicas",
                transform: {"position":[-78,0,40]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_ELE_A_220: {
                src: "/3D/policlinica/modelo-08.xkt",
                label: "Elétrica 220 V — ar-condicionado",
                transform: {"position":[-78,0,40],"rotation":[0,-45,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_LOG: {
                src: "/3D/policlinica/modelo-09.xkt",
                label: "Cabeamento estruturado",
                transform: {"position":[-78,0,40]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_TEF: {
                src: "/3D/policlinica/modelo-10.xkt",
                label: "Telefonia",
                transform: {"position":[-78,0,40]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_ALI_220: {
                src: "/3D/policlinica/modelo-11.xkt",
                label: "Alimentadores 220 V",
                transform: {"position":[-78,0,40]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_ALI_380: {
                src: "/3D/policlinica/modelo-12.xkt",
                label: "Alimentadores 380 V",
                transform: {"position":[-78,0,40]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_IRRI: {
                src: "/3D/policlinica/modelo-13.xkt",
                label: "Irrigação",
                transform: {"position":[-78,0,40],"rotation":[0,-45,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
        }
    },
    farmacia: {
        name: "Farmácia do Jânio",
        models: {
            IFC_LOG_TEF: {
                src: "/3D/drogaria/modelo-05.xkt",
                label: "Cabeamento estruturado e telefonia",
                transform: {"position":[14.09,0,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_ELE: {
                src: "/3D/drogaria/modelo-04.xkt",
                label: "Instalações elétricas",
                transform: {"position":[14.09,0,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_EST: {
                src: "/3D/drogaria/modelo-06.xkt",
                label: "Estrutura",
                transform: {"position":[2.22,0,2.61]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_SAN: {
                src: "/3D/drogaria/modelo-08.xkt",
                label: "Instalações sanitárias",
                transform: {"position":[14.09,0,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_PLU: {
                src: "/3D/drogaria/modelo-07.xkt",
                label: "Águas pluviais",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_ARQ: {
                src: "/3D/drogaria/modelo-09.xkt",
                label: "Arquitetura",
                transform: {"position":[14.09,0,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_FOT: {
                src: "/3D/drogaria/modelo-03.xkt",
                label: "Sistema fotovoltaico",
                transform: {"position":[14.09,0,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_ALI: {
                src: "/3D/drogaria/modelo-01.xkt",
                label: "Alimentadores elétricos",
                transform: {"position":[14.09,0,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_CLI: {
                src: "/3D/drogaria/modelo-10.xkt",
                label: "Climatização",
                transform: {"position":[14.09,0,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_HID: {
                src: "/3D/drogaria/modelo-11.xkt",
                label: "Instalações hidráulicas",
                transform: {"position":[0,0,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_INC: {
                src: "/3D/drogaria/modelo-12.xkt",
                label: "Prevenção e combate a incêndio",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_EXA: {
                src: "/3D/drogaria/modelo-13.xkt",
                label: "Exaustão",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
        }
    },
    fecomercio: {
        name: "Fecomércio",
        models: {
            IFC_EST: {
                src: "/3D/fecomercio/ifc-est-fecomercio.xkt",
                label: "Estrutura",
                transform: {"position":[0,-0.1,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_ELE: {
                src: "/3D/fecomercio/ifc-ele-fecomercio.xkt",
                label: "Instalações elétricas",
                transform: {"position":[0,0,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_ARQ: {
                src: "/3D/fecomercio/ifc-arq-fecomercio.xkt",
                label: "Arquitetura",
                transform: {"position":[-18.7,0,8.95]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_SAN_PLU: {
                src: "/3D/fecomercio/ifc-san-plu-fecomercio.xkt",
                label: "Instalações sanitárias e águas pluviais",
                transform: {"position":[50,0,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_HID: {
                src: "/3D/fecomercio/ifc-hid-fecomercio.xkt",
                label: "Instalações hidráulicas",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
        }
    },
    esc_canaa: {
        name: "Escola Canaã",
        models: {
            IFC_ELE: {
                src: "/3D/esc_canaa/modelo-01.xkt",
                label: "Instalações elétricas",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_ILUX: {
                src: "/3D/esc_canaa/modelo-02.xkt",
                label: "Iluminação externa",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_LOG: {
                src: "/3D/esc_canaa/modelo-03.xkt",
                label: "Cabeamento estruturado",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_ALI: {
                src: "/3D/esc_canaa/modelo-04.xkt",
                label: "Alimentadores elétricos",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_INC: {
                src: "/3D/esc_canaa/modelo-05.xkt",
                label: "Prevenção e combate a incêndio",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_EST_PP: {
                src: "/3D/esc_canaa/modelo-06.xkt",
                label: "Estrutura do prédio principal",
                transform: {"position":[48.212,0.385,-36.8995]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_SUB: {
                src: "/3D/esc_canaa/modelo-07.xkt",
                label: "Subestação",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_CLI: {
                src: "/3D/esc_canaa/modelo-08.xkt",
                label: "Climatização",
                transform: {"position":[0,-0.05,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_ILU: {
                src: "/3D/esc_canaa/modelo-09.xkt",
                label: "Iluminação",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_SPDA: {
                src: "/3D/esc_canaa/modelo-10.xkt",
                label: "SPDA",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_HID: {
                src: "/3D/esc_canaa/modelo-11.xkt",
                label: "Instalações hidráulicas",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_SAN: {
                src: "/3D/esc_canaa/modelo-12.xkt",
                label: "Instalações sanitárias",
                transform: {"position":[-0.03,-0.1,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_EXA: {
                src: "/3D/esc_canaa/modelo-13.xkt",
                label: "Exaustão",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_ARQ: {
                src: "/3D/esc_canaa/modelo-14.xkt",
                label: "Arquitetura",
                transform: {"position":[48.25,0,-36.8695]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_PLU: {
                src: "/3D/esc_canaa/modelo-15.xkt",
                label: "Águas pluviais",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_EST_EMT: {
                src: "/3D/esc_canaa/modelo-16.xkt",
                label: "Estrutura do edifício multiuso",
                transform: {"position":[48.212,0.075,-36.8995],"rotation":[0,180,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_SDAI: {
                src: "/3D/esc_canaa/modelo-17.xkt",
                label: "Detecção e alarme de incêndio",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_GLP: {
                src: "/3D/esc_canaa/modelo-18.xkt",
                label: "GLP",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_IRRI: {
                src: "/3D/esc_canaa/modelo-19.xkt",
                label: "Irrigação",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
        }
    },
    psb: {
        name: "Posto São Bento",
        models: {
            IFC_ARQ: {
                src: "/3D/psb/XKT-ARQ-PSB.xkt",
                label: "Arquitetura",
                transform: {"position":[5.85876,0,-3.7959]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_CLI: {
                src: "/3D/psb/XKT-CLI-PSB.xkt",
                label: "Climatização",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_ELE: {
                src: "/3D/psb/XKT-ELE-PSB.xkt",
                label: "Instalações elétricas",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_EST: {
                src: "/3D/psb/XKT-EST-PSB.xkt",
                label: "Estrutura",
                transform: {"position":[5.85876,0.14,-3.7959]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_EXA: {
                src: "/3D/psb/XKT-EXA-PSB.xkt",
                label: "Exaustão",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_HID: {
                src: "/3D/psb/XKT-HID-PSB.xkt",
                label: "Instalações hidráulicas",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_INC: {
                src: "/3D/psb/XKT-INC-PSB.xkt",
                label: "Prevenção e combate a incêndio",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_LOG: {
                src: "/3D/psb/XKT-LOG-PSB.xkt",
                label: "Cabeamento estruturado",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_PLU: {
                src: "/3D/psb/XKT-PLU-PSB.xkt",
                label: "Águas pluviais",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_SAN: {
                src: "/3D/psb/XKT-SAN-PSB.xkt",
                label: "Instalações sanitárias",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_SDO: {
                src: "/3D/psb/XKT-SDO-PSB.xkt",
                label: "Instalações de drenagem oleosa",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_TANQUE: {
                src: "/3D/psb/XKT-TANQUE-PSB.xkt",
                label: "Tanque",
                public: { enabled: true },
                authenticated: { enabled: true }
            },
        }
    },
    sesc_centro_ecologico: {
        name: "SESC Centro Ecológico",
        models: {
            IFC_ARQ_SESC_GERAL: {
                src: "/3D/sesc_centro_ecologico/XKT-ARQ-SESC-GERAL.xkt",
                label: "Arquitetura geral",
                transform: {"position":[257.26,0,33.02],"rotation":[0,16.4,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
        }
    },
    sebrae_rr: {
        name: "SEBRAE RR",
        models: {
            IFC_ALI: {
                src: "/3D/sebrae-rr/modelo-01.xkt",
                label: "Alimentadores elétricos",
                transform: {"position":[15,0,50]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
        }
    },
    esc_modelo: {
        name: "Escola Modelo",
        models: {
            IFC_EST_PP: {
                src: "/3D/esc_modelo/modelo-01.xkt",
                label: "Estrutura do prédio principal",
                transform: {"position":[45,-2.05,25],"rotation":[0,0,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_ARQ: {
                src: "/3D/esc_modelo/modelo-02.xkt",
                label: "Arquitetura",
                transform: {"position":[354.6,0,3187.75],"rotation":[0,0,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_CLI: {
                src: "/3D/esc_modelo/modelo-03.xkt",
                label: "Climatização",
                transform: {"position":[354.6,0,3187.75],"rotation":[0,0,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_SAN: {
                src: "/3D/esc_modelo/modelo-04.xkt",
                label: "Instalações sanitárias",
                transform: {"position":[354.6,0,3187.75],"rotation":[0,0,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
            IFC_PLU: {
                src: "/3D/esc_modelo/modelo-05.xkt",
                label: "Águas pluviais",
                transform: {"position":[354.6,0,3187.75],"rotation":[0,0,0]},
                public: { enabled: true },
                authenticated: { enabled: true }
            },
        }
    },
};

const VALID_MODES = new Set(["public", "authenticated"]);
const ZERO_VECTOR = Object.freeze([0, 0, 0]);

function resolveMode(mode) {
    const requestedMode = typeof mode === "object" ? mode?.mode : mode;
    if (VALID_MODES.has(requestedMode)) return requestedMode;
    if (requestedMode !== undefined) {
        console.warn(`[project-config] Modo "${requestedMode}" inválido; usando "public".`);
    }
    return "public";
}

function resolveVector(value, fallback, modelId, field, mode) {
    if (value === undefined) return [...fallback];
    if (Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)) return [...value];
    console.warn(`[project-config] ${field} inválida para o modelo ${modelId} (${mode}); usando fallback seguro.`);
    return [...fallback];
}

function resolveModel(modelId, definition, mode) {
    const context = definition?.[mode] || {};
    if (context.enabled === false) return null;

    const src = context.src ?? definition?.src;
    if (!src || typeof src !== "string") {
        console.warn(`[project-config] Modelo ${modelId} habilitado sem src (${mode}); ele não será carregado.`);
        return null;
    }

    const commonTransform = definition?.transform || {};
    const contextTransform = context.transform || {};
    const position = resolveVector(
        contextTransform.position ?? context.position,
        resolveVector(commonTransform.position, ZERO_VECTOR, modelId, "position", mode),
        modelId,
        "position",
        mode
    );
    const rotation = resolveVector(
        contextTransform.rotation ?? context.rotation,
        resolveVector(commonTransform.rotation, ZERO_VECTOR, modelId, "rotation", mode),
        modelId,
        "rotation",
        mode
    );

    return {
        model: { id: modelId, src, label: definition.label || DISCIPLINE_LABELS[modelId] || "Modelo do projeto" },
        transform: { position, rotation }
    };
}

export function hasProjectConfig(projectKey) {
    return Object.prototype.hasOwnProperty.call(PROJECT_CONFIGS, projectKey);
}

export function getProjectConfig(projectKey, mode = "public") {
    const resolvedMode = resolveMode(mode);
    const project = PROJECT_CONFIGS[projectKey] || PROJECT_CONFIGS.lacen;
    const models = [];
    const transforms = {};

    Object.entries(project.models || {}).forEach(([modelId, definition]) => {
        const resolved = resolveModel(modelId, definition, resolvedMode);
        if (!resolved) return;
        models.push(resolved.model);
        transforms[modelId] = resolved.transform;
    });

    return { name: project.name, models, transforms };
}
