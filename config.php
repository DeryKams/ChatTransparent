<?php
/**
 * Конфигурация ChatTransparent — единственное место для изменения настроек модуля.
 * Подключается из handler.php и ajax.php.
 */

// entityTypeId смарт-процесса, чат которого мы показываем в карточке сделки.
// Это число из URL смарт-процесса: /page/.../type/1042/details/1459/
// Здесь 1042 — это entityTypeId (тип сущности), 1459 — itemId (конкретная запись).
// Если понадобится другой смарт-процесс — поменяй эту константу.
if (!defined('CHAT_TRANSPARENT_SMART_PROCESS_TYPE_ID'))
{
    define('CHAT_TRANSPARENT_SMART_PROCESS_TYPE_ID', 1042);
}

// 'sp'   — вход только при праве чтения СП (нативный crm.timeline.chat.get)
// 'deal' — вход при праве чтения СДЕЛКИ, без проверки доступа к СП (наш AJAX)
if (!defined('CHAT_TRANSPARENT_ACCESS_MODE'))
{
    define('CHAT_TRANSPARENT_ACCESS_MODE', 'deal');
}

// Регулярка для детекта страницы карточки сделки.
// Стандартный URL:  /crm/deal/details/123/
// SPA-вариант:      /page/.../deal/details/123/  или  /crm/deal/details/
// Также покрывает цифровые рабочие места.
if (!defined('CHAT_TRANSPARENT_DEAL_URL_REGEX'))
{
    define('CHAT_TRANSPARENT_DEAL_URL_REGEX', '#/crm/deal/details/(\\d+)#');
}
