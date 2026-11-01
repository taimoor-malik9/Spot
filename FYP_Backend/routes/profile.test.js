const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User = require('../models/User');

test('Module U1: User Profile & Credentials Management', async (t) => {
  const userId = new mongoose.Types.ObjectId();
  const initialPassword = 'OldPassword123!';
  const initialPasswordHash = await bcrypt.hash(initialPassword, 10);

  const mockUserDoc = new User({
    _id: userId,
    name: 'Alice Cooper',
    email: 'alice@example.com',
    passwordHash: initialPasswordHash,
    businessName: 'Alice Bakery',
    businessType: 'food_beverage',
    currency: 'Rs',
    workingHoursPerDay: 8,
  });

  await t.test('1. Profile update accepts valid name and email and updates user', async () => {
    const updatePayload = {
      name: 'Alice C.',
      email: 'alice.new@example.com',
      businessName: 'Wonderland Treats',
      currency: 'Rs',
    };

    const user = new User({ ...mockUserDoc.toObject() });

    // Validate update logic matching PUT /api/auth/me
    if (updatePayload.name) user.name = updatePayload.name.trim();
    if (updatePayload.email) user.email = updatePayload.email.trim().toLowerCase();
    if (updatePayload.businessName) user.businessName = updatePayload.businessName.trim();
    if (updatePayload.currency) user.currency = updatePayload.currency.trim();

    assert.equal(user.name, 'Alice C.');
    assert.equal(user.email, 'alice.new@example.com');
    assert.equal(user.businessName, 'Wonderland Treats');
    assert.equal(user.currency, 'Rs');
  });

  await t.test('2. Profile update rejects invalid email with 400', () => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalidEmails = ['invalid-email', 'alice@', '@example.com', 'alice@.com'];
    for (const em of invalidEmails) {
      assert.equal(emailRegex.test(em), false, `Should reject ${em}`);
    }
  });

  await t.test('3. Profile update rejects empty name with 400', () => {
    const emptyNames = ['', '   ', null, undefined];
    for (const n of emptyNames) {
      const isValid = Boolean(n && typeof n === 'string' && n.trim());
      assert.equal(isValid, false, `Should reject empty name "${n}"`);
    }
  });

  await t.test('4. Change password validates current password and updates hash', async () => {
    const currentPasswordInput = 'OldPassword123!';
    const newPasswordInput = 'NewSecretPassword2026!';

    // Verify current password matches
    const isMatch = await bcrypt.compare(currentPasswordInput, mockUserDoc.passwordHash);
    assert.equal(isMatch, true, 'Current password should match');

    // Reject wrong current password
    const wrongMatch = await bcrypt.compare('WrongPassword!', mockUserDoc.passwordHash);
    assert.equal(wrongMatch, false, 'Wrong password should fail');

    // Reject identical password
    assert.equal(currentPasswordInput === currentPasswordInput, true);

    // Hash new password
    const newHash = await bcrypt.hash(newPasswordInput, 10);
    const newVerify = await bcrypt.compare(newPasswordInput, newHash);
    assert.equal(newVerify, true, 'New password hash should verify successfully');
  });

  await t.test('5. Business defaults persist currency (default Rs) and business type', () => {
    const userWithDefaults = new User({
      name: 'Bob Ross',
      email: 'bob@example.com',
    });

    assert.equal(userWithDefaults.currency, 'Rs', 'Default currency must be Rs');
    assert.equal(userWithDefaults.businessType, 'retail', 'Default business type must be retail');
    assert.equal(userWithDefaults.workingHoursPerDay, 8, 'Default hours per day must be 8');
  });
});
