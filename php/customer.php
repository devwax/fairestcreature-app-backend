<?php
/**
 * Staging: create or complete customer (no password) + DOB/notes metafields + not_reviewed tag.
 * New customer accounts: OTP may auto-create a bare profile before Request Allocation —
 * look up by email and update incomplete customers instead of failing on duplicate.
 */
require_once __DIR__ . '/bootstrap.php';
fc_apply_cors();

$shop = fc_config('SHOPIFY_SHOP');
$token = fc_config('SHOPIFY_ADMIN_TOKEN');
$apiVersion = fc_config('SHOPIFY_API_VERSION', '2024-10');

if (!$shop || !$token || strpos($token, 'xxx') !== false) {
	fc_json(array('status' => false, 'data' => 'Missing SHOPIFY_SHOP / SHOPIFY_ADMIN_TOKEN in fairestcreature-app-backend/.env'));
}

$data = fc_parse_body();
if (empty($data) || empty($data['email'])) {
	fc_json(array('status' => false, 'data' => ''));
}

$email = trim((string) $data['email']);

function fc_shopify_json($token, $shop, $endpoint, $payload, $method) {
	$response = shopify_call($token, $shop, $endpoint, $payload, $method);
	if (!is_array($response) || !isset($response['response'])) {
		return null;
	}
	return json_decode($response['response'], true);
}

function fc_find_customer_by_email($token, $shop, $apiVersion, $email) {
	$decoded = fc_shopify_json(
		$token,
		$shop,
		"/admin/api/{$apiVersion}/customers/search.json",
		array('query' => 'email:' . $email),
		'GET'
	);
	if (!$decoded || empty($decoded['customers']) || !is_array($decoded['customers'])) {
		return null;
	}
	$emailLower = strtolower($email);
	foreach ($decoded['customers'] as $customer) {
		if (isset($customer['email']) && strtolower($customer['email']) === $emailLower) {
			return $customer;
		}
	}
	return $decoded['customers'][0];
}

function fc_customer_tags_list($customer) {
	$raw = isset($customer['tags']) ? (string) $customer['tags'] : '';
	if ($raw === '') {
		return array();
	}
	return array_values(array_filter(array_map('trim', explode(',', $raw))));
}

function fc_customer_has_metafield($token, $shop, $apiVersion, $customerId, $key) {
	$decoded = fc_shopify_json(
		$token,
		$shop,
		"/admin/api/{$apiVersion}/customers/{$customerId}/metafields.json",
		array(),
		'GET'
	);
	if (!$decoded || empty($decoded['metafields'])) {
		return false;
	}
	foreach ($decoded['metafields'] as $mf) {
		if (($mf['namespace'] ?? '') === 'custom' && ($mf['key'] ?? '') === $key) {
			$value = $mf['value'] ?? '';
			if ($value !== '' && $value !== null) {
				return true;
			}
		}
	}
	return false;
}

function fc_customer_is_allocation_registered($token, $shop, $apiVersion, $customer) {
	$tags = fc_customer_tags_list($customer);
	if (in_array('not_reviewed', $tags, true)) {
		return true;
	}
	$id = $customer['id'] ?? null;
	if (!$id) {
		return false;
	}
	if (fc_customer_has_metafield($token, $shop, $apiVersion, $id, 'date_of_birth')) {
		return true;
	}
	if (fc_customer_has_metafield($token, $shop, $apiVersion, $id, 'allocations_collections')) {
		return true;
	}
	return false;
}

function fc_merge_not_reviewed_tags($customer) {
	$tags = fc_customer_tags_list($customer);
	if (!in_array('not_reviewed', $tags, true)) {
		$tags[] = 'not_reviewed';
	}
	return implode(', ', $tags);
}

function fc_address_payload($data) {
	return array(
		'company' => $data['company'] ?? '',
		'address1' => $data['address1'] ?? '',
		'address2' => $data['address2'] ?? '',
		'city' => $data['city'] ?? '',
		'province' => $data['province'] ?? '',
		'phone' => $data['phone'] ?? '',
		'zip' => $data['zip'] ?? '',
		'last_name' => $data['last_name'] ?? '',
		'first_name' => $data['first_name'] ?? '',
		'country' => $data['country'] ?? '',
		'default' => true,
	);
}

function fc_set_customer_metafield($token, $shop, $apiVersion, $customerId, $key, $value, $type) {
	$list = fc_shopify_json(
		$token,
		$shop,
		"/admin/api/{$apiVersion}/customers/{$customerId}/metafields.json",
		array(),
		'GET'
	);
	$existingId = null;
	if ($list && !empty($list['metafields'])) {
		foreach ($list['metafields'] as $mf) {
			if (($mf['namespace'] ?? '') === 'custom' && ($mf['key'] ?? '') === $key) {
				$existingId = $mf['id'] ?? null;
				break;
			}
		}
	}
	$metafield = array(
		'namespace' => 'custom',
		'key' => $key,
		'value' => (string) $value,
		'type' => $type,
	);
	if ($existingId) {
		fc_shopify_json(
			$token,
			$shop,
			"/admin/api/{$apiVersion}/metafields/{$existingId}.json",
			array('metafield' => array_merge($metafield, array('id' => $existingId))),
			'PUT'
		);
	} else {
		fc_shopify_json(
			$token,
			$shop,
			"/admin/api/{$apiVersion}/customers/{$customerId}/metafields.json",
			array('metafield' => $metafield),
			'POST'
		);
	}
}

function fc_apply_registration_metafields($token, $shop, $apiVersion, $customerId, $data) {
	if (!empty($data['dateofbirth'])) {
		fc_set_customer_metafield(
			$token,
			$shop,
			$apiVersion,
			$customerId,
			'date_of_birth',
			$data['dateofbirth'],
			'single_line_text_field'
		);
	}
	if (isset($data['additionalnotes']) && $data['additionalnotes'] !== '') {
		fc_set_customer_metafield(
			$token,
			$shop,
			$apiVersion,
			$customerId,
			'additional_notes',
			$data['additionalnotes'],
			'multi_line_text_field'
		);
	}
}

function fc_upsert_address($token, $shop, $apiVersion, $customer, $data) {
	$customerId = $customer['id'];
	$address = fc_address_payload($data);
	$addresses = isset($customer['addresses']) && is_array($customer['addresses']) ? $customer['addresses'] : array();
	if (count($addresses) === 0) {
		return fc_shopify_json(
			$token,
			$shop,
			"/admin/api/{$apiVersion}/customers/{$customerId}/addresses.json",
			array('customer_address' => $address),
			'POST'
		);
	}
	$addressId = $addresses[0]['id'];
	return fc_shopify_json(
		$token,
		$shop,
		"/admin/api/{$apiVersion}/customers/{$customerId}/addresses/{$addressId}.json",
		array('customer_address' => $address),
		'PUT'
	);
}

$existing = fc_find_customer_by_email($token, $shop, $apiVersion, $email);

if ($existing) {
	if (fc_customer_is_allocation_registered($token, $shop, $apiVersion, $existing)) {
		fc_json(array(
			'status' => false,
			'data' => 'An allocation request for this email was already submitted. If you need help, contact info@fairestcreature.com.',
		));
	}

	$customerId = $existing['id'];
	$updated = fc_shopify_json(
		$token,
		$shop,
		"/admin/api/{$apiVersion}/customers/{$customerId}.json",
		array(
			'customer' => array(
				'id' => $customerId,
				'first_name' => $data['first_name'] ?? '',
				'last_name' => $data['last_name'] ?? '',
				'phone' => $data['phone'] ?? '',
				'tags' => fc_merge_not_reviewed_tags($existing),
			),
		),
		'PUT'
	);

	if (!$updated) {
		fc_json(array('status' => false, 'data' => 'Empty Shopify response'));
	}
	if (isset($updated['errors'])) {
		fc_json(array('status' => false, 'data' => $updated['errors']));
	}

	$addrResult = fc_upsert_address($token, $shop, $apiVersion, $existing, $data);
	if ($addrResult && isset($addrResult['errors'])) {
		fc_json(array('status' => false, 'data' => $addrResult['errors']));
	}

	fc_apply_registration_metafields($token, $shop, $apiVersion, $customerId, $data);
	fc_json(array('status' => true, 'data' => ''));
}

$customerData = array(
	'customer' => array(
		'first_name' => $data['first_name'] ?? '',
		'last_name' => $data['last_name'] ?? '',
		'email' => $email,
		'phone' => $data['phone'] ?? '',
		'verified_email' => true,
		'addresses' => array(fc_address_payload($data)),
		'tags' => 'not_reviewed',
		'send_email_welcome' => false,
	),
);

$decoded = fc_shopify_json(
	$token,
	$shop,
	"/admin/api/{$apiVersion}/customers.json",
	$customerData,
	'POST'
);

if (!$decoded) {
	fc_json(array('status' => false, 'data' => 'Empty Shopify response'));
}

if (isset($decoded['errors'])) {
	fc_json(array('status' => false, 'data' => $decoded['errors']));
}

$customerId = $decoded['customer']['id'] ?? null;
if ($customerId) {
	fc_apply_registration_metafields($token, $shop, $apiVersion, $customerId, $data);
}

fc_json(array('status' => true, 'data' => ''));
