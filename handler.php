<?php
/**
 * ChatTransparent — OnProlog хук.
 *
 * Детектит страницу карточки сделки в CRM и подключает JS/CSS,
 * которые рендерят кнопку чата смарт-процесса в таймлайне сделки.
 *
 * Подключается из /local/php_interface/init.php:
 *   require_once __DIR__ . '/../ChatTransparent/handler.php';
 *
 * Файлы модуля лежат в /local/ChatTransparent/
 */

// Антиспам: не подключаемся повторно, если init.php вызван дважды
if (defined('CHAT_TRANSPARENT_HANDLER_INCLUDED'))
{
    return;
}
define('CHAT_TRANSPARENT_HANDLER_INCLUDED', true);

require_once __DIR__ . '/config.php';

/**
 * ============================================================
 * Хук OnProlog — срабатывает в начале каждой страницы
 * ============================================================
 *
 * Используем OnProlog для детекта страницы сделки и подготовки конфига.
 * Сама инъекция JS/CSS делается через Asset API.
 */
AddEventHandler('main', 'OnProlog', static function ()
{
    // Не работаем в админке — там нет таймлайна сделки
    if (defined('ADMIN_SECTION') && ADMIN_SECTION === true)
    {
        return;
    }

    // Проверяем, что мы на странице карточки сделки
    $requestUri = $_SERVER['REQUEST_URI'] ?? '';
    if (!preg_match(CHAT_TRANSPARENT_DEAL_URL_REGEX, $requestUri, $matches))
    {
        return;
    }

    $dealId = (int)$matches[1];
    if ($dealId <= 0)
    {
        return;
    }

    // Путь к файлам модуля (относительно document_root)
    $moduleDir = '/local/ChatTransparent';

    // Передаём конфигурацию в JS через глобальную переменную
    $config = [
        'dealId'             => $dealId,
        'smartProcessTypeId' => CHAT_TRANSPARENT_SMART_PROCESS_TYPE_ID,
        'accessMode'         => CHAT_TRANSPARENT_ACCESS_MODE,
        'ajaxUrl'            => $moduleDir . '/ajax.php',
        // Текст надписи когда чат уже существует
        'buttonLabel'        => '',
        // Текст надписи когда чата ещё нет (режим приглашения)
        'inviteLabel'        => '',
    ];

    $jsonConfig = \CUtil::PhpToJSObject($config);

    // CSS-файл с cache-busting по времени модификации
    $cssPath = $_SERVER['DOCUMENT_ROOT'] . $moduleDir . '/style.css';
    $cssUrl  = $moduleDir . '/style.css?v=' . (file_exists($cssPath) ? filemtime($cssPath) : 0);

    // JS-файл с cache-busting
    $jsPath = $_SERVER['DOCUMENT_ROOT'] . $moduleDir . '/script.js';
    $jsUrl  = $moduleDir . '/script.js?v=' . (file_exists($jsPath) ? filemtime($jsPath) : 0);

    // Подключаем CSS через стандартный Asset API
    \Bitrix\Main\Page\Asset::getInstance()->addCss($cssUrl);

    // Инъекция: конфиг + подключение script.js одним инлайн-блоком.
    // Используем addString с <script> тегами — это надёжнее, чем addJs,
    // потому что addJs может не отработать на SPA-страницах CRM.
    // AFTER_JS_KERNEL — выполняется после загрузки BX-фреймворка,
    // но до TEMPLATE_PAGE скриптов. Это гарантирует:
    // 1. BX уже доступен (нужен для BX.ready, BX.ajax)
    // 2. window.ChatTransparentConfig установлен до выполнения script.js
    $inlineScript = '<script>'
        . 'window.ChatTransparentConfig = ' . $jsonConfig . ';'
        . '</script>'
        . '<script src="' . $jsUrl . '"></script>';

    \Bitrix\Main\Page\Asset::getInstance()->addString(
        $inlineScript,
        false,
        \Bitrix\Main\Page\AssetLocation::AFTER_JS_KERNEL
    );
});
