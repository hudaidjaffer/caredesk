import { Mail, Phone } from 'lucide-react';

// The software owner's support contact (set in the owner panel).
export default function Contact({ product, center }) {
  if (!product.support_name && !product.support_email && !product.support_phone) return null;
  return (
    <div className="stack" style={{ gap: 6, alignItems: center ? 'center' : 'flex-start' }}>
      {product.support_name && <b>{product.support_name}</b>}
      {product.support_email && <div className="row" style={{ gap: 6 }}><Mail size={16} /><a href={`mailto:${product.support_email}`}>{product.support_email}</a></div>}
      {product.support_phone && <div className="row" style={{ gap: 6 }}><Phone size={16} /><a href={`tel:${product.support_phone}`}>{product.support_phone}</a></div>}
    </div>
  );
}
