<?php
/**
 * ChatTransparent — AJAX-эндпоинт.
 *
 * Принимает POST-запросы от script.js:
 *   action=getChildChats  dealId=123
 *
 * Возвращает JSON-массив смарт-процессов заданного типа (по умолчанию 1042),
 * привязанных к сделке, с данными их чатов:
 *   - chatId (если чат уже создан)
 *   - аватары участников (ответственный + наблюдатели)
 *   - последнее сообщение (если чат есть)
 *
 * Если у смарт-процесса нет чата (chatId = 0) — он возвращается с
 * hasChat: false. Кнопка рендерится в режиме "Пригласить к обсуждению".
 * При клике joinChat() создаст чат автоматически.
 *
 * ВАЖНО: этот файл подключает prolog_before.php — он выполняется
 * в контексте Bitrix24 и имеет доступ ко всем API.
 */

// ==================================================================
// КОНФИГУРАЦИЯ — меняй эти значения под свой портал
// ==================================================================

// entityTypeId смарт-процесса, чат которого мы показываем в сделке.
// Это число из URL: /page/.../type/1042/details/1459/
// Здесь 1042 — entityTypeId (тип сущности).
const CHAT_TRANSPARENT_SMART_PROCESS_TYPE_ID = 1042;

// entityTypeId сделки (в Bitrix24 это всегда 2 — CCrmOwnerType::Deal)
const CHAT_TRANSPARENT_DEAL_TYPE_ID = 2;

// ==================================================================
// BOOTSTRAP BITRIX24
// ==================================================================

// prolog_before.php — даёт доступ ко всем API Bitrix24 (CModule, Loader, и т.д.)
// Без этой строки: Fatal error: Class "CModule" not found
require_once $_SERVER['DOCUMENT_ROOT'] . '/bitrix/modules/main/include/prolog_before.php';

// Подключаем модули CRM и IM (мессенджер)
\Bitrix\Main\Loader::includeModule('crm');
\Bitrix\Main\Loader::includeModule('im');

// ==================================================================
// ВХОДНЫЕ ДАННЫЕ
// ==================================================================

$action = $_POST['action'] ?? '';
$dealId = (int)($_POST['dealId'] ?? 0);

if ($action !== 'getChildChats' || $dealId <= 0)
{
    // Неверный запрос — возвращаем пустой массив
    header('Content-Type: application/json');
    echo json_encode([]);
    die();
}

// ==================================================================
// ПОИСК СМАРТ-ПРОЦЕССОВ, ПРИВЯЗАННЫХ К СДЕЛКЕ
// ==================================================================

/**
 * Связь смарт-процесс <-> сделка хранится в таблице b_crm_entity_relation.
 * Сделка — родитель (SRC), смарт-процесс — потомок (DST).
 *
 * Мы ищем все записи, где:
 *   SRC_ENTITY_TYPE_ID = 2 (Deal)
 *   SRC_ENTITY_ID      = $dealId
 *   DST_ENTITY_TYPE_ID = 1042 (наш смарт-процесс)
 *
 * Возвращает массив ItemIdentifier(entityTypeId, entityId).
 */

// Способ 1: через D7 RelationManager (канонический путь)
$relationManager = \Bitrix\Crm\Service\Container::getInstance()->getRelationManager();
$parent = new \Bitrix\Crm\ItemIdentifier(CHAT_TRANSPARENT_DEAL_TYPE_ID, $dealId);

// Получаем ВСЕ дочерние элементы сделки (всех типов)
$allChildren = $relationManager->getChildElements($parent);

// Фильтруем только нужный тип смарт-процесса
$smartProcessItems = [];
foreach ($allChildren as $child)
{
    if ($child->getEntityTypeId() === CHAT_TRANSPARENT_SMART_PROCESS_TYPE_ID)
    {
        $smartProcessItems[] = $child;
    }
}

// Способ 2 (альтернативный): прямой SQL к b_crm_entity_relation.
// Раскомментируй, если RelationManager не находит связь (например,
// связь зарегистрирована не через bindTypes, а через поле PARENT_ID_2).
/*
global $DB;
$sql = "
    SELECT DST_ENTITY_ID
    FROM b_crm_entity_relation
    WHERE SRC_ENTITY_TYPE_ID = " . CHAT_TRANSPARENT_DEAL_TYPE_ID . "
      AND SRC_ENTITY_ID = " . $dealId . "
      AND DST_ENTITY_TYPE_ID = " . CHAT_TRANSPARENT_SMART_PROCESS_TYPE_ID . "
";
$res = $DB->Query($sql);
$smartProcessItems = [];
while ($row = $res->Fetch())
{
    $smartProcessItems[] = new \Bitrix\Crm\ItemIdentifier(
        CHAT_TRANSPARENT_SMART_PROCESS_TYPE_ID,
        (int)$row['DST_ENTITY_ID']
    );
}
*/

// ==================================================================
// СБОР ДАННЫХ О ЧАТАХ НАЙДЕННЫХ СМАРТ-ПРОЦЕССОВ
// ==================================================================

$result = [];

foreach ($smartProcessItems as $item)
{
    $entityTypeId = $item->getEntityTypeId();
    $entityId     = $item->getEntityId();

    // Получаем chatId сущности.
    // Im\Chat::getChatId ищет в b_im_chat запись с
    //   ENTITY_TYPE = 'CRM', ENTITY_ID = 'DYNAMIC_1042|{entityId}'
    $chatId = \Bitrix\Crm\Integration\Im\Chat::getChatId($entityTypeId, $entityId);

    // Получаем заголовок смарт-процесса (нужен в обоих случаях)
    $title = getItemTitle($entityTypeId, $entityId);

    // Получаем пользователей (ответственный + наблюдатели) — нужны для аватаров
    // в обоих случаях: и когда чат есть, и когда его нет
    $userInfos = getUserInfos($entityTypeId, $entityId);

    // --- Чата нет: возвращаем смарт-процесс в режиме приглашения ---
    // Кнопка рендерится с надписью "Пригласить к обсуждению" и аватарами.
    // При клике joinChat() создаст чат автоматически.
    if ($chatId <= 0)
    {
        $result[] = [
            'entityTypeId' => $entityTypeId,
            'entityId'     => $entityId,
            'title'        => $title,
            'chatId'       => 0,
            'hasChat'      => false,
            'userInfos'    => $userInfos,
            'message'      => null,
        ];
        continue;
    }

    // --- Чат есть: собираем полные данные (как в нативном crm.timeline) ---

    // Получаем последнее сообщение чата
    $messageData = null;
    $messages = \Bitrix\Im\Chat::getMessages(
        $chatId,
        null,
        [
            'LIMIT'         => 1,
            'USER_TAG_SPREAD' => 'Y',
            'JSON'          => 'Y',
        ]
    );
    if (is_array($messages) && !empty($messages['messages']) && is_array($messages['messages']))
    {
        $messageData = $messages['messages'][0];
    }

    // Получаем отношения (кто в чате, счётчики непрочитанных)
    $relations = \Bitrix\Im\Chat::getRelation(
        $chatId,
        [
            'SELECT' => ['ID', 'USER_ID', 'COUNTER'],
        ]
    );

    // Дополняем userInfos счётчиками непрочитанных
    foreach ($relations as $relation)
    {
        $userId = $relation['USER_ID'];
        if (isset($userInfos[$userId]))
        {
            $userInfos[$userId]['counter'] = $relation['COUNTER'];
        }
    }

    $result[] = [
        'entityTypeId' => $entityTypeId,
        'entityId'     => $entityId,
        'title'        => $title,
        'chatId'       => $chatId,
        'hasChat'      => true,
        'userInfos'    => $userInfos,
        'message'      => $messageData,
    ];
}

// ==================================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ==================================================================

/**
 * Получает заголовок (TITLE) элемента смарт-процесса по его typeId и itemId.
 *
 * Использует D7 Factory — канонический способ работы со смарт-процессами.
 * Container::getInstance()->getFactory($entityTypeId) возвращает фабрику
 * для динамического типа сущности.
 */
function getItemTitle(int $entityTypeId, int $entityId): string
{
    $factory = \Bitrix\Crm\Service\Container::getInstance()->getFactory($entityTypeId);
    if (!$factory)
    {
        return '#' . $entityId;
    }

    $item = $factory->getItem($entityId);
    if (!$item)
    {
        return '#' . $entityId;
    }

    // У смарт-процессов заголовок может быть в поле TITLE
    // или вычисляться через getTitle()
    $title = $item->getTitle();
    if (empty($title))
    {
        $title = '#' . $entityId;
    }

    return $title;
}

/**
 * Получает список пользователей, связанных со смарт-процессом:
 * ответственный (ASSIGNED_BY_ID) + наблюдатели (observers).
 *
 * Возвращает массив в формате, совместимом с нативным EntityChat:
 *   [userId => {avatar, name, ...}]
 */
function getUserInfos(int $entityTypeId, int $entityId): array
{
    // Получаем ID пользователей: ответственный + наблюдатели
    $userIds = \Bitrix\Crm\Integration\Im\Chat::getEntityUserIDs($entityTypeId, $entityId);
    if (empty($userIds))
    {
        return [];
    }

    $userInfos = [];
    foreach ($userIds as $userId)
    {
        // Im\User::getInstance()->getArray() — возвращает данные пользователя
        // (имя, аватар, и т.д.) в формате для JSON
        $userInfo = \Bitrix\Im\User::getInstance($userId)->getArray(['JSON' => 'Y']);
        if ($userInfo)
        {
            $userInfos[$userId] = $userInfo;
        }
    }

    return $userInfos;
}

// ==================================================================
// ОТВЕТ
// ==================================================================

header('Content-Type: application/json');
echo json_encode($result);