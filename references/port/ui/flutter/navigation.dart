// DualCraft UI idioms — Flutter navigation (go_router).
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

// @idiom routes — Route table with parameters
final router = GoRouter(
  initialLocation: '/',
  routes: [
    GoRoute(path: '/', builder: (context, state) => const HomePage()),
    GoRoute(path: '/product/:id', builder: (context, state) => ProductPage(id: state.pathParameters['id']!)),
  ],
);
class HomePage extends StatelessWidget {
  const HomePage({super.key});
  @override
  Widget build(BuildContext context) => TextButton(onPressed: () => context.push('/product/42'), child: const Text('Ver'));
}
class ProductPage extends StatelessWidget {
  const ProductPage({super.key, required this.id});
  final String id;
  @override
  Widget build(BuildContext context) => Text('Producto $id');
}

// @idiom navigate — Push, back, replace the stack, return a result
Future<void> navigateExamples(BuildContext context) async {
  context.push('/product/42'); // push
  context.pop(); // back
  context.go('/'); // replace the stack (e.g. after login)
  final picked = await context.push<String>('/product/42'); // the destination returns with context.pop('value')
  if (picked != null && context.mounted) context.go('/');
}

// @idiom tabs — Bottom navigation keeping one stack per tab
final tabsRouter = GoRouter(initialLocation: '/home', routes: [
  StatefulShellRoute.indexedStack(
    builder: (context, state, shell) => Scaffold(
      body: shell,
      bottomNavigationBar: NavigationBar(
        selectedIndex: shell.currentIndex,
        onDestinationSelected: shell.goBranch,
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home), label: 'Inicio'),
          NavigationDestination(icon: Icon(Icons.person), label: 'Perfil'),
        ],
      ),
    ),
    branches: [
      StatefulShellBranch(routes: [GoRoute(path: '/home', builder: (context, state) => const HomePage())]),
      StatefulShellBranch(routes: [GoRoute(path: '/me', builder: (context, state) => const Text('Perfil'))]),
    ],
  ),
]);
