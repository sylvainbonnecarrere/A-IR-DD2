import { RobotMenuItem, RobotId } from '../types';
import {
  HardHatIcon,
  AntennaIcon,
  MonitoringIcon,
  FileAnalysisIcon,
  ClockIcon,
  WrenchIcon,
  PlusIcon,
  SettingsIcon,
  DashboardIcon,
  BriefcaseIcon,
  MessageSquareIcon,
  ShieldIcon,
  RobotIcon,
  NetworkIcon,
  WorkflowIcon,
  BlueprintIcon,
  HeartbeatIcon,
  ChartIcon,
  AdminIcon,
  GameIcon,
  PlugIcon,
  DatabaseIcon,
  VectorIcon,
  HandshakeIcon,
  HubIcon,
  SearchIcon,
  FileProcessIcon,
  CodeIcon,
  PackageIcon,
  BookIcon,
  LightningIcon,
  CalendarIcon,
  EyeIcon,
  SpeedometerIcon,
  AsyncIcon,
  RobotHeadIcon,
  ChecklistMemoIcon,
  ElectricPlugIcon
} from '../components/Icons';

/**
 * Configuration de navigation pour les 5 robots spécialisés du système V2
 * Chaque robot a son icône distinctive et ses sous-menus correspondants à son mandat
 */
export const ROBOT_MENU_DATA: RobotMenuItem[] = [
  // ARCHI - Robot Architecte (AR_001)
  {
    id: RobotId.Archi,
    name: 'robot_archi_name',
    iconComponent: HardHatIcon,
    path: '/archi/prototype',
    description: 'robot_archi_description',
    nestedItems: [
      {
        id: RobotId.Archi,
        name: 'nav_prototyping',
        iconComponent: WrenchIcon,
        path: '/archi/prototype',
        description: 'nav_prototyping_desc'
      },
      {
        id: RobotId.Archi,
        name: 'archi_instanciation_agents',
        iconComponent: RobotHeadIcon,
        path: '/archi/instanciation',
        description: 'archi_instanciation_agents_desc'
      },
      {
        id: RobotId.Archi,
        name: 'archi_liens_interactions',
        iconComponent: NetworkIcon,
        path: '/archi/links',
        description: 'archi_liens_interactions_desc'
      },
      {
        id: RobotId.Archi,
        name: 'archi_gestion_taches',
        iconComponent: ChecklistMemoIcon,
        path: '/archi/tasks',
        description: 'archi_gestion_taches_desc'
      },
      {
        id: RobotId.Archi,
        name: 'archi_bibliotheque_prototypes',
        iconComponent: BlueprintIcon,
        path: '/archi/library',
        description: 'archi_bibliotheque_prototypes_desc'
      }
    ]
  },

  // BOS - Robot Superviseur (BO_002)
  {
    id: RobotId.Bos,
    name: 'robot_bos_name',
    iconComponent: MonitoringIcon,
    path: '/bos/dashboard',
    description: 'robot_bos_description',
    nestedItems: [
      {
        id: RobotId.Bos,
        name: 'nav_dashboard',
        iconComponent: DashboardIcon,
        path: '/bos/dashboard',
        description: 'nav_dashboard_desc'
      },
      {
        id: RobotId.Bos,
        name: 'bos_monitoring_live',
        iconComponent: HeartbeatIcon,
        path: '/bos/monitoring',
        description: 'bos_monitoring_live_desc'
      },
      {
        id: RobotId.Bos,
        name: 'bos_analytics_couts',
        iconComponent: ChartIcon,
        path: '/bos/analytics',
        description: 'bos_analytics_couts_desc'
      },
      {
        id: RobotId.Bos,
        name: 'bos_gouvernance_utilisateurs',
        iconComponent: AdminIcon,
        path: '/bos/governance',
        description: 'bos_gouvernance_utilisateurs_desc'
      },
      {
        id: RobotId.Bos,
        name: 'bos_playground_public',
        iconComponent: GameIcon,
        path: '/bos/playground',
        description: 'bos_playground_public_desc'
      }
    ]
  },

  // COM - Robot Communicateur (CO_003)
  {
    id: RobotId.Com,
    name: 'robot_com_name',
    iconComponent: AntennaIcon,
    path: '/com/connections',
    description: 'robot_com_description',
    nestedItems: [
      {
        id: RobotId.Com,
        name: 'com_connexions_api',
        iconComponent: ElectricPlugIcon,
        path: '/com/connections',
        description: 'com_connexions_api_desc'
      },
      {
        id: RobotId.Com,
        name: 'com_bases_donnees',
        iconComponent: DatabaseIcon,
        path: '/com/databases',
        description: 'com_bases_donnees_desc'
      },
      {
        id: RobotId.Com,
        name: 'com_bdd_vectorielles',
        iconComponent: VectorIcon,
        path: '/com/vector-db',
        description: 'com_bdd_vectorielles_desc'
      },
      {
        id: RobotId.Com,
        name: 'com_integrations_mcp',
        iconComponent: HandshakeIcon,
        path: '/com/mcp',
        description: 'com_integrations_mcp_desc'
      },
      {
        id: RobotId.Com,
        name: 'com_hub_connecteurs',
        iconComponent: HubIcon,
        path: '/com/hub',
        description: 'com_hub_connecteurs_desc'
      }
    ]
  },

  // PHIL - Robot Penseur (PH_004)
  {
    id: RobotId.Phil,
    name: 'robot_phil_name',
    iconComponent: FileAnalysisIcon,
    path: '/phil/rag',
    description: 'robot_phil_description',
    nestedItems: [
      {
        id: RobotId.Phil,
        name: 'phil_rag_configuration',
        iconComponent: SearchIcon,
        path: '/phil/rag',
        description: 'phil_rag_configuration_desc'
      },
      {
        id: RobotId.Phil,
        name: 'phil_file_handling',
        iconComponent: FileProcessIcon,
        path: '/phil/files',
        description: 'phil_file_handling_desc'
      },
      {
        id: RobotId.Phil,
        name: 'phil_fonctions_personnalisees',
        iconComponent: CodeIcon,
        path: '/phil/functions',
        description: 'phil_fonctions_personnalisees_desc'
      },
      {
        id: RobotId.Phil,
        name: 'phil_bibliotheques_externes',
        iconComponent: PackageIcon,
        path: '/phil/libraries',
        description: 'phil_bibliotheques_externes_desc'
      },
      {
        id: RobotId.Phil,
        name: 'phil_knowledge_base',
        iconComponent: BookIcon,
        path: '/phil/knowledge',
        description: 'phil_knowledge_base_desc'
      }
    ]
  },

  // TIM - Robot Temporel (TI_005)
  {
    id: RobotId.Tim,
    name: 'robot_tim_name',
    iconComponent: ClockIcon,
    path: '/tim/triggers',
    description: 'robot_tim_description',
    nestedItems: [
      {
        id: RobotId.Tim,
        name: 'tim_triggers_webhooks',
        iconComponent: LightningIcon,
        path: '/tim/triggers',
        description: 'tim_triggers_webhooks_desc'
      },
      {
        id: RobotId.Tim,
        name: 'tim_scheduling',
        iconComponent: CalendarIcon,
        path: '/tim/scheduling',
        description: 'tim_scheduling_desc'
      },
      {
        id: RobotId.Tim,
        name: 'tim_polling_watch',
        iconComponent: EyeIcon,
        path: '/tim/polling',
        description: 'tim_polling_watch_desc'
      },
      {
        id: RobotId.Tim,
        name: 'tim_rate_limiting',
        iconComponent: SpeedometerIcon,
        path: '/tim/rate-limiting',
        description: 'tim_rate_limiting_desc'
      },
      {
        id: RobotId.Tim,
        name: 'tim_async_management',
        iconComponent: AsyncIcon,
        path: '/tim/async',
        description: 'tim_async_management_desc'
      }
    ]
  }
];

/**
 * Mapping des capacités par robot selon leur spécialisation
 */
export const ROBOT_CAPABILITIES = {
  [RobotId.Archi]: [
    { id: 'agent_creation', name: 'Création d\'agents', description: 'Définir de nouveaux prototypes d\'agents' },
    { id: 'orchestration', name: 'Orchestration', description: 'Architecture des flux de communication' },
    { id: 'governance', name: 'Gouvernance', description: 'Validation et approbation des modifications' }
  ],
  [RobotId.Bos]: [
    { id: 'supervision', name: 'Supervision', description: 'Monitoring des workflows en cours' },
    { id: 'debugging', name: 'Débogage', description: 'Analyse et résolution des erreurs' },
    { id: 'cost_monitoring', name: 'Suivi des coûts', description: 'Monitoring de l\'utilisation LLM' }
  ],
  [RobotId.Com]: [
    { id: 'api_integration', name: 'Intégrations API', description: 'Connexions vers services externes' },
    { id: 'authentication', name: 'Authentification', description: 'Gestion des accès et permissions' },
    { id: 'data_exchange', name: 'Échange de données', description: 'Protocoles de communication' }
  ],
  [RobotId.Phil]: [
    { id: 'data_transformation', name: 'Transformation', description: 'Conversion et formatage des données' },
    { id: 'validation', name: 'Validation', description: 'Vérification de conformité des données' },
    { id: 'file_handling', name: 'Gestion fichiers', description: 'Upload, processing et stockage' }
  ],
  [RobotId.Tim]: [
    { id: 'event_triggers', name: 'Déclencheurs', description: 'Configuration des événements' },
    { id: 'scheduling', name: 'Planification', description: 'Gestion des exécutions temporelles' },
    { id: 'rate_limiting', name: 'Limitation débit', description: 'Contrôle des appels API' }
  ]
};