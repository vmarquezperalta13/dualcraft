// DualCraft UI idioms — Flutter forms and feedback.
import 'package:flutter/material.dart';

// @idiom text-field — Text input bound to state
class NameField extends StatefulWidget {
  const NameField({super.key, required this.onChanged});
  final ValueChanged<String> onChanged;
  @override
  State<NameField> createState() => _NameFieldState();
}
class _NameFieldState extends State<NameField> {
  final _controller = TextEditingController();
  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }
  @override
  Widget build(BuildContext context) => TextField(
        controller: _controller,
        decoration: const InputDecoration(labelText: 'Nombre'),
        textInputAction: TextInputAction.next,
        onChanged: widget.onChanged,
      );
}

// @idiom validation — Validate fields and submit
class SignUpForm extends StatefulWidget {
  const SignUpForm({super.key, required this.onSubmit});
  final ValueChanged<String> onSubmit;
  @override
  State<SignUpForm> createState() => _SignUpFormState();
}
class _SignUpFormState extends State<SignUpForm> {
  final _formKey = GlobalKey<FormState>();
  String _email = '';
  void _submit() {
    if (!_formKey.currentState!.validate()) return;
    _formKey.currentState!.save();
    widget.onSubmit(_email);
  }
  @override
  Widget build(BuildContext context) => Form(
        key: _formKey,
        child: Column(children: [
          TextFormField(
            decoration: const InputDecoration(labelText: 'Email'),
            keyboardType: TextInputType.emailAddress,
            validator: (v) => v != null && v.contains('@') ? null : 'Email no válido',
            onSaved: (v) => _email = v ?? '',
          ),
          FilledButton(onPressed: _submit, child: const Text('Enviar')),
        ]),
      );
}

// @idiom dialog — Confirmation dialog returning a value
Future<bool> confirmDelete(BuildContext context) async =>
    await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('¿Eliminar?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Eliminar')),
        ],
      ),
    ) ??
    false;

// @idiom snackbar — Transient message
void showSaved(BuildContext context) => ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Guardado')));

// @idiom bottom-sheet — Modal bottom sheet
Future<void> showOptions(BuildContext context) => showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (context) => const SafeArea(child: ListTile(title: Text('Compartir'))),
    );
