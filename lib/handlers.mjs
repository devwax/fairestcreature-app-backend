import { getApiVersion, shopify } from './shopify-admin.mjs';

function addressPayload(data) {
  return {
    company: data.company || '',
    address1: data.address1 || '',
    address2: data.address2 || '',
    city: data.city || '',
    province: data.province || '',
    phone: data.phone || '',
    zip: data.zip || '',
    last_name: data.last_name || '',
    first_name: data.first_name || '',
    country: data.country || '',
    default: true,
  };
}

function tagsList(customer) {
  const raw = customer?.tags || '';
  if (!raw) return [];
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function mergeNotReviewedTags(customer) {
  const tags = tagsList(customer);
  if (!tags.includes('not_reviewed')) tags.push('not_reviewed');
  return tags.join(', ');
}

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function isNanpCountry(country) {
  const cc = String(country || '').trim().toLowerCase();
  return !cc || /^(united states|usa|us|united states of america|canada|ca)$/.test(cc);
}

/** Shopify customer.phone must be E.164. Form values are often (707) 555-1212. */
export function normalizePhone(raw, country) {
  const original = String(raw || '').trim();
  if (!original) return '';
  const digits = digitsOnly(original);
  if (!digits) return '';
  if (isNanpCountry(country)) {
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  }
  if (original.startsWith('+') && digits.length >= 8 && digits.length <= 15) {
    return `+${digits}`;
  }
  if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  return original;
}

function phoneMessages(errors) {
  const phone = errors?.phone;
  if (Array.isArray(phone)) return phone.map(String);
  if (typeof phone === 'string') return [phone];
  return [];
}

function phoneAlreadyTaken(errors) {
  return phoneMessages(errors).some((msg) => /already been taken/i.test(msg));
}

function phoneUnusableOnCustomer(errors) {
  return phoneMessages(errors).some((msg) => /already been taken|is invalid/i.test(msg));
}

function formatCustomerErrors(errors) {
  if (!errors) return 'Could not save your allocation request. Please try again.';
  if (typeof errors === 'string') return errors;
  if (phoneAlreadyTaken(errors)) {
    return 'This phone number is already used on another Fairest Creature account. Use a different number, or log in with that account and continue Request Allocation.';
  }
  if (phoneMessages(errors).some((msg) => /is invalid/i.test(msg))) {
    return 'Enter a valid phone number with area code (US numbers like 707-555-1212).';
  }
  if (Array.isArray(errors.email)) return `Email ${errors.email[0]}`;
  if (Array.isArray(errors.phone)) return `Phone ${errors.phone[0]}`;
  const addressCountry = errors.addresses?.country;
  if (Array.isArray(addressCountry)) return addressCountry[0];
  try {
    return JSON.stringify(errors);
  } catch {
    return 'Could not save your allocation request. Please try again.';
  }
}

async function customerHasMetafield(customerId, key) {
  const api = getApiVersion();
  const list = await shopify('GET', `/admin/api/${api}/customers/${customerId}/metafields.json`);
  const metafields = list?.metafields || [];
  return metafields.some(
    (mf) => mf.namespace === 'custom' && mf.key === key && mf.value !== '' && mf.value != null
  );
}

async function customerIsAllocationRegistered(customer) {
  if (tagsList(customer).includes('not_reviewed')) return true;
  const id = customer?.id;
  if (!id) return false;
  if (await customerHasMetafield(id, 'date_of_birth')) return true;
  if (await customerHasMetafield(id, 'allocations_collections')) return true;
  return false;
}

async function findCustomerByEmail(email) {
  const api = getApiVersion();
  const q = encodeURIComponent(`email:${email}`);
  const result = await shopify('GET', `/admin/api/${api}/customers/search.json?query=${q}`);
  const customers = result?.customers || [];
  if (!customers.length) return null;
  const emailLower = String(email).toLowerCase();
  return customers.find((c) => String(c.email || '').toLowerCase() === emailLower) || customers[0];
}

async function setCustomerMetafield(customerId, key, value, type) {
  const api = getApiVersion();
  const list = await shopify('GET', `/admin/api/${api}/customers/${customerId}/metafields.json`);
  const existing = (list?.metafields || []).find((mf) => mf.namespace === 'custom' && mf.key === key);
  const metafield = { namespace: 'custom', key, value: String(value), type };
  if (existing?.id) {
    await shopify('PUT', `/admin/api/${api}/metafields/${existing.id}.json`, {
      metafield: { ...metafield, id: existing.id },
    });
  } else {
    await shopify('POST', `/admin/api/${api}/customers/${customerId}/metafields.json`, { metafield });
  }
}

async function applyRegistrationMetafields(customerId, data) {
  if (data.dateofbirth) {
    await setCustomerMetafield(customerId, 'date_of_birth', data.dateofbirth, 'single_line_text_field');
  }
  if (data.additionalnotes) {
    await setCustomerMetafield(customerId, 'additional_notes', data.additionalnotes, 'multi_line_text_field');
  }
}

async function upsertAddress(customer, data) {
  const api = getApiVersion();
  const customerId = customer.id;
  const address = addressPayload(data);
  const addresses = customer.addresses || [];
  if (!addresses.length) {
    return shopify('POST', `/admin/api/${api}/customers/${customerId}/addresses.json`, {
      customer_address: address,
    });
  }
  const addressId = addresses[0].id;
  return shopify('PUT', `/admin/api/${api}/customers/${customerId}/addresses/${addressId}.json`, {
    customer_address: address,
  });
}

export async function handleCustomerCreate(data) {
  const api = getApiVersion();
  const email = String(data.email || '').trim();
  if (!email) return { status: false, data: '' };

  const phone = normalizePhone(data.phone, data.country);
  const form = { ...data, phone };

  const existing = await findCustomerByEmail(email);
  if (existing) {
    if (await customerIsAllocationRegistered(existing)) {
      return {
        status: false,
        data: 'An allocation request for this email was already submitted. If you need help, contact info@fairestcreature.com.',
      };
    }

    const profile = {
      id: existing.id,
      first_name: form.first_name || '',
      last_name: form.last_name || '',
      tags: mergeNotReviewedTags(existing),
    };
    if (phone) profile.phone = phone;
    let updated = await shopify('PUT', `/admin/api/${api}/customers/${existing.id}.json`, {
      customer: profile,
    });
    if (updated.errors && phoneUnusableOnCustomer(updated.errors) && profile.phone) {
      delete profile.phone;
      updated = await shopify('PUT', `/admin/api/${api}/customers/${existing.id}.json`, {
        customer: profile,
      });
    }
    if (updated.errors) return { status: false, data: formatCustomerErrors(updated.errors) };

    const addrResult = await upsertAddress(existing, form);
    if (addrResult?.errors) return { status: false, data: formatCustomerErrors(addrResult.errors) };

    await applyRegistrationMetafields(existing.id, form);
    return { status: true, data: '' };
  }

  const customer = {
    first_name: form.first_name || '',
    last_name: form.last_name || '',
    email,
    verified_email: true,
    addresses: [addressPayload(form)],
    tags: 'not_reviewed',
    send_email_welcome: false,
  };
  if (phone) customer.phone = phone;

  let created = await shopify('POST', `/admin/api/${api}/customers.json`, { customer });
  if (created.errors && phoneUnusableOnCustomer(created.errors) && customer.phone) {
    delete customer.phone;
    created = await shopify('POST', `/admin/api/${api}/customers.json`, { customer });
  }
  if (created.errors) return { status: false, data: formatCustomerErrors(created.errors) };

  const id = created.customer?.id;
  if (id) await applyRegistrationMetafields(id, form);

  return { status: true, data: '' };
}

export async function handleCustomerAccount(data) {
  const api = getApiVersion();
  if (!data.customer_id) return { status: false, data: '' };
  const updated = await shopify('PUT', `/admin/api/${api}/customers/${data.customer_id}.json`, {
    customer: {
      id: data.customer_id,
      first_name: data.first_name || '',
      last_name: data.last_name || '',
      phone: data.phone || '',
    },
  });
  if (updated.errors) return { status: false, data: updated.errors };
  return { status: true, data: '' };
}

export async function handleCustomerUpdate(data) {
  const api = getApiVersion();
  if (!data.customer_id) return { status: false, data: '' };
  const isDefault = Object.prototype.hasOwnProperty.call(data, 'default');
  let updated;
  if (data.address_id) {
    updated = await shopify(
      'PUT',
      `/admin/api/${api}/customers/${data.customer_id}/addresses/${data.address_id}.json`,
      {
        customer_address: {
          customer_id: data.customer_id,
          company: data.company || '',
          address1: data.address1 || '',
          address2: data.address2 || '',
          city: data.city || '',
          province: data.province || '',
          phone: data.phone || '',
          zip: data.zip || '',
          last_name: data.last_name || '',
          first_name: data.first_name || '',
          country: data.country || '',
          default: isDefault,
        },
      }
    );
  } else {
    updated = await shopify('PUT', `/admin/api/${api}/customers/${data.customer_id}.json`, {
      customer: {
        id: data.customer_id,
        addresses: [
          {
            company: data.company || '',
            address1: data.address1 || '',
            address2: data.address2 || '',
            city: data.city || '',
            province: data.province || '',
            phone: data.phone || '',
            zip: data.zip || '',
            last_name: data.last_name || '',
            first_name: data.first_name || '',
            country: data.country || '',
            default: isDefault,
          },
        ],
      },
    });
  }
  if (updated.errors) return { status: false, data: updated.errors };
  return { status: true, data: '' };
}

/**
 * Route pathname (no query) to a handler result.
 * @param {string} pathname
 * @param {Record<string, string>} data
 */
export async function routeRequest(pathname, data) {
  const path = (pathname || '/').replace(/\/+$/, '') || '/';

  if (path === '/customer.php' || path === '/customer') {
    return handleCustomerCreate(data);
  }
  if (path === '/customer-account.php' || path === '/customer-account') {
    return handleCustomerAccount(data);
  }
  if (path === '/customer-update.php' || path === '/customer-update') {
    return handleCustomerUpdate(data);
  }
  if (path === '/customer-change-password.php' || path === '/customer-change-password') {
    return { status: false, data: 'Password changes disabled under new customer accounts' };
  }
  return { statusCode: 404, status: false, data: 'Not found' };
}
